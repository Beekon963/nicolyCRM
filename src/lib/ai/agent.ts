import "server-only";
import type { BetaMessage, BetaMessageParam, BetaTextBlockParam, BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import type { AiContext, AiTool } from "./common";
import type { Proposal } from "./proposals";
import { runTool } from "./tools";

/**
 * AI アシスタントのやりとり（Phase 4-4）。
 * Claude に聞く → 道具を使いたいと言われたら使って結果を返す → … を、答えが出るまで（最大 MAX_STEPS 回）くり返す。
 * 画面には、文章の途中経過・「〇〇を調べています」・確認カードを順に送る。
 *
 * - AI の考え（thinking）は毎回入る。返ってきた中身は、考えの記録も含めてそのまま会話に足し、次も変えずに送る
 *   （途中を書き換えると、それより後の考えの記録が使えなくなる）。古いやりとりを落としたときなどは
 *   drop_block で「使えなくなった記録だけ外して続ける」ようにする（エラーで止めない）
 * - 答えを断られたときは、決まった別のモデルで答え直す（fallbacks: "default"）
 * - 道具の入力は小さい（ID と短い文）ので、少しずつ受け取る設定（eager_input_streaming）は使わない
 */

export type AiEvent =
  | { type: "text"; text: string }
  | { type: "tool"; label: string }
  | { type: "proposal"; proposal: Proposal }
  | { type: "done"; messages: BetaMessageParam[] }
  | { type: "error"; message: string };

export const BETAS = ["thinking-binding-controls-2026-08-01", "server-side-fallback-2026-07-01"];

export type AgentRequest = {
  model: string;
  max_tokens: number;
  system: BetaTextBlockParam[];
  tools: BetaTool[];
  messages: BetaMessageParam[];
  thinking: { type: "adaptive"; block_binding: { prefix_mismatch_behavior: "drop_block" } };
  output_config: { effort: "medium" };
  cache_control: { type: "ephemeral" };
  fallbacks: "default";
  betas: string[];
};

/** 使う部分だけ（テストでは偽物を渡す） */
export type StreamingClient = {
  beta: {
    messages: {
      stream(params: AgentRequest, options?: { signal?: AbortSignal }): { on(event: "text", listener: (delta: string) => void): unknown; finalMessage(): Promise<BetaMessage> };
    };
  };
};

export const MAX_STEPS = 8;
const MAX_TOKENS = 16_000;

export async function runAgent(opts: {
  client: StreamingClient;
  model: string;
  system: BetaTextBlockParam[];
  tools: AiTool[];
  definitions: BetaTool[];
  ctx: AiContext;
  messages: BetaMessageParam[];
  send: (e: AiEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const history = [...opts.messages];
  const added: BetaMessageParam[] = [];
  const push = (m: BetaMessageParam) => {
    history.push(m);
    added.push(m);
  };
  for (let step = 0; step < MAX_STEPS; step++) {
    const stream = opts.client.beta.messages.stream(
      {
        model: opts.model,
        max_tokens: MAX_TOKENS,
        system: opts.system,
        tools: opts.definitions,
        messages: history,
        thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
        output_config: { effort: "medium" },
        // 会話の前の部分をキャッシュして、道具を使うたびの料金を減らす
        cache_control: { type: "ephemeral" },
        fallbacks: "default",
        betas: BETAS,
      },
      { signal: opts.signal },
    );
    stream.on("text", (t) => opts.send({ type: "text", text: t }));
    const msg = await stream.finalMessage();
    // 考えの記録・別のモデルで答え直した印も含めて、そのまま残す
    push({ role: "assistant", content: msg.content as BetaMessageParam["content"] });
    if (msg.stop_reason === "refusal") {
      opts.send({ type: "text", text: "\nこの内容にはお答えできません。聞き方を変えて送ってください。" });
      break;
    }
    if (msg.stop_reason === "max_tokens") {
      opts.send({ type: "text", text: "\n（長くなったので、ここで止めました。続きは分けて聞いてください）" });
      break;
    }
    const uses = msg.content.filter((b) => b.type === "tool_use");
    if (msg.stop_reason !== "tool_use" || !uses.length) break;

    const results = [];
    for (const u of uses) {
      const tool = opts.tools.find((t) => t.name === u.name);
      opts.send({ type: "tool", label: tool?.label ?? "調べています" });
      const out = await runTool(opts.ctx, opts.tools, u.name, u.input);
      if (out.proposal) opts.send({ type: "proposal", proposal: out.proposal });
      results.push({ type: "tool_result" as const, tool_use_id: u.id, content: out.content, is_error: out.isError || undefined });
    }
    // 道具の結果は1つのメッセージにまとめて返す
    push({ role: "user", content: results });
    if (step === MAX_STEPS - 1) {
      // 道具を使い続けて終わらないときは、ここまでで止める
      opts.send({ type: "text", text: "\n（調べることが多いので、ここで止めました。聞きたいことを分けて送ってください）" });
      push({ role: "assistant", content: [{ type: "text", text: "（ここで止めました）" }] });
    }
  }
  opts.send({ type: "done", messages: added });
}

// ---------------------------------------------------------------------------
// 画面から届く会話の形を確かめる（画面の値をそのまま Claude に渡さない）
// ---------------------------------------------------------------------------

const MAX_IMAGE_CHARS = 2_800_000; // base64 で約2MB
const text = z.string().min(1).max(20_000);
/** 利用者の発言（文・画像・道具の結果）。形を決めて、知らないものは受け付けない */
const userBlock = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(20_000) }),
  z.object({
    type: z.literal("image"),
    source: z.object({ type: z.literal("base64"), media_type: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]), data: z.string().max(MAX_IMAGE_CHARS) }),
  }),
  z.object({
    type: z.literal("tool_result"),
    tool_use_id: z.string().max(200),
    content: z.union([z.string().max(200_000), z.array(z.object({ type: z.literal("text"), text: z.string().max(200_000) }))]).optional(),
    is_error: z.boolean().optional(),
  }),
]);
/** AI の答え（前に AI から返ってきたもの）。考えの記録（署名つき）などを含むので、中身を変えずにそのまま返す */
const assistantBlock = z.looseObject({ type: z.string().max(60) });

export const conversationSchema = z
  .array(
    z.discriminatedUnion("role", [
      z.object({ role: z.literal("user"), content: z.union([text, z.array(userBlock).min(1).max(40)]) }),
      z.object({ role: z.literal("assistant"), content: z.union([text, z.array(assistantBlock).min(1).max(80)]) }),
    ]),
  )
  .min(1)
  .max(120)
  .refine((ms) => ms.length > 0 && ms[0].role === "user" && ms.at(-1)!.role === "user", "会話の形が正しくありません")
  .refine((ms) => ms.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "image").length <= 8, "画像は8枚までです");
