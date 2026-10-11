import "server-only";
import type { Message, MessageParam, TextBlockParam, Tool } from "@anthropic-ai/sdk/resources/messages";
import { z } from "zod";
import type { AiContext, AiTool } from "./common";
import type { Proposal } from "./proposals";
import { runTool } from "./tools";

/**
 * AI アシスタントのやりとり（Phase 4-4）。
 * Claude に聞く → 道具を使いたいと言われたら使って結果を返す → … を、答えが出るまで（最大 MAX_STEPS 回）くり返す。
 * 画面には、文章の途中経過・「〇〇を調べています」・確認カードを順に送る。
 */

export type AiEvent =
  | { type: "text"; text: string }
  | { type: "tool"; label: string }
  | { type: "proposal"; proposal: Proposal }
  | { type: "done"; messages: MessageParam[] }
  | { type: "error"; message: string };

/** 使う部分だけ（テストでは偽物を渡す） */
export type StreamingClient = {
  messages: {
    stream(
      params: { model: string; max_tokens: number; system: TextBlockParam[]; tools: Tool[]; messages: MessageParam[] },
      options?: { signal?: AbortSignal },
    ): { on(event: "text", listener: (delta: string) => void): unknown; finalMessage(): Promise<Message> };
  };
};

export const MAX_STEPS = 8;
const MAX_TOKENS = 4096;

export async function runAgent(opts: {
  client: StreamingClient;
  model: string;
  system: TextBlockParam[];
  tools: AiTool[];
  definitions: Tool[];
  ctx: AiContext;
  messages: MessageParam[];
  send: (e: AiEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const history = [...opts.messages];
  const added: MessageParam[] = [];
  const push = (m: MessageParam) => {
    history.push(m);
    added.push(m);
  };
  for (let step = 0; step < MAX_STEPS; step++) {
    const stream = opts.client.messages.stream(
      { model: opts.model, max_tokens: MAX_TOKENS, system: opts.system, tools: opts.definitions, messages: history },
      { signal: opts.signal },
    );
    stream.on("text", (t) => opts.send({ type: "text", text: t }));
    const msg = await stream.finalMessage();
    push({ role: "assistant", content: msg.content });
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
const block = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().max(20_000) }),
  z.object({
    type: z.literal("image"),
    source: z.object({ type: z.literal("base64"), media_type: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]), data: z.string().max(MAX_IMAGE_CHARS) }),
  }),
  z.object({ type: z.literal("tool_use"), id: z.string().max(200), name: z.string().max(100), input: z.unknown() }),
  z.object({
    type: z.literal("tool_result"),
    tool_use_id: z.string().max(200),
    content: z.union([z.string().max(200_000), z.array(z.object({ type: z.literal("text"), text: z.string().max(200_000) }))]).optional(),
    is_error: z.boolean().optional(),
  }),
]);

export const conversationSchema = z
  .array(z.object({ role: z.enum(["user", "assistant"]), content: z.union([z.string().min(1).max(20_000), z.array(block).min(1).max(40)]) }))
  .min(1)
  .max(80)
  .refine((ms) => ms.length > 0 && ms[0].role === "user" && ms.at(-1)!.role === "user", "会話の形が正しくありません")
  .refine((ms) => ms.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "image").length <= 8, "画像は8枚までです");
