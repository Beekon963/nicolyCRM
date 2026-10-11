import type { BetaMessage as Message } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type AgentRequest, type AiEvent, conversationSchema, MAX_STEPS, runAgent, type StreamingClient } from "./agent";
import type { AiContext, AiTool } from "./common";
import { toolDefinitions, toolsFor } from "./tools";

const ctx = { supabase: {} as AiContext["supabase"], user: { id: "u", name: "テスト", email: "t@example.com", role: "manager" }, today: "2026-10-11" } as AiContext;

const msg = (content: Message["content"], stop: Message["stop_reason"]): Message =>
  ({ id: "m", type: "message", role: "assistant", model: "x", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } }) as unknown as Message;

/** 決めた順に答える偽の Claude。受け取った会話も残す */
function fakeClient(replies: Message[]) {
  const calls: (AgentRequest & { messages: unknown[] })[] = [];
  const client: StreamingClient = {
    beta: { messages: {
      stream(params) {
        calls.push(structuredClone(params));
        const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
        return {
          on(_e: "text", fn: (t: string) => void) {
            for (const b of reply.content) if (b.type === "text") fn(b.text);
            return this;
          },
          finalMessage: async () => reply,
        };
      },
    } },
  };
  return { client, calls };
}

const echo: AiTool = { name: "echo", label: "まねしています", description: "", schema: z.object({ q: z.string() }), run: async (_c, i: { q: string }) => ({ heard: i.q }) };
const propose: AiTool = {
  name: "propose_x",
  label: "カードを作っています",
  description: "",
  schema: z.object({}),
  run: async () => ({ proposal: { id: "p1", kind: "activity", title: "テストのカード", rows: [], warnings: [], payload: {} } }),
};

async function run(replies: Message[], tools: AiTool[] = [echo, propose]) {
  const { client, calls } = fakeClient(replies);
  const events: AiEvent[] = [];
  await runAgent({ client, model: "m", system: [], tools, definitions: toolDefinitions(tools), ctx, messages: [{ role: "user", content: "こんにちは" }], send: (e) => events.push(e) });
  return { events, calls };
}

describe("AI アシスタントのやりとり", () => {
  it("道具を使わない答えは、そのまま文章で返して終わる", async () => {
    const { events, calls } = await run([msg([{ type: "text", text: "はい", citations: null }], "end_turn")]);
    expect(calls).toHaveLength(1);
    expect(events.map((e) => e.type)).toEqual(["text", "done"]);
    const done = events.at(-1) as Extract<AiEvent, { type: "done" }>;
    expect(done.messages).toHaveLength(1);
  });

  it("道具を使いたいと言われたら使い、結果を返してもう一度聞く", async () => {
    const { events, calls } = await run([
      msg([{ type: "tool_use", id: "t1", name: "echo", input: { q: "青木" }, caller: { type: "direct" } }], "tool_use"),
      msg([{ type: "text", text: "青木さんでした", citations: null }], "end_turn"),
    ]);
    expect(calls).toHaveLength(2);
    expect(events.map((e) => e.type)).toEqual(["tool", "text", "done"]);
    expect(events[0]).toEqual({ type: "tool", label: "まねしています" });
    const second = calls[1].messages.at(-1) as { role: string; content: { type: string; tool_use_id: string; content: string }[] };
    expect(second.role).toBe("user");
    expect(second.content[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1", content: JSON.stringify({ heard: "青木" }) });
    const done = events.at(-1) as Extract<AiEvent, { type: "done" }>;
    expect(done.messages.map((m) => m.role)).toEqual(["assistant", "user", "assistant"]);
  });

  it("propose_* は確認カードを画面に送り、AI には「まだ登録していない」と返す", async () => {
    const { events, calls } = await run([
      msg([{ type: "tool_use", id: "t1", name: "propose_x", input: {}, caller: { type: "direct" } }], "tool_use"),
      msg([{ type: "text", text: "確かめてください", citations: null }], "end_turn"),
    ]);
    expect(events.find((e) => e.type === "proposal")).toMatchObject({ proposal: { title: "テストのカード" } });
    const result = (calls[1].messages.at(-1) as { content: { content: string }[] }).content[0].content;
    expect(result).toContain("まだ登録していません");
  });

  it("知らない道具・入力の誤りは、エラーとして AI に返す（止まらない）", async () => {
    const { calls } = await run([
      msg(
        [
          { type: "tool_use", id: "t1", name: "money_month", input: { month: "2026-10" }, caller: { type: "direct" } },
          { type: "tool_use", id: "t2", name: "echo", input: { q: 1 }, caller: { type: "direct" } },
        ],
        "tool_use",
      ),
      msg([{ type: "text", text: "すみません", citations: null }], "end_turn"),
    ]);
    const results = (calls[1].messages.at(-1) as { content: { is_error?: boolean; content: string }[] }).content;
    expect(results.map((r) => r.is_error)).toEqual([true, true]);
    expect(results[0].content).toBe("その道具は使えません");
  });

  it(`道具を使い続けても ${MAX_STEPS} 回で止める`, async () => {
    const { calls, events } = await run([msg([{ type: "tool_use", id: "t", name: "echo", input: { q: "x" }, caller: { type: "direct" } }], "tool_use")]);
    expect(calls).toHaveLength(MAX_STEPS);
    expect(events.at(-1)?.type).toBe("done");
  });
});

describe("AI に送る設定", () => {
  const thinking = { type: "thinking", thinking: "", signature: "sig-1" } as Message["content"][number];

  it("考えの記録は外さず、書き換わったときは外して続ける（drop_block）。断られたら別のモデルで答え直す", async () => {
    const { calls, events } = await run([msg([thinking, { type: "text", text: "はい", citations: null }], "end_turn")]);
    const req = calls[0];
    expect(req.thinking).toEqual({ type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } });
    expect(req.fallbacks).toBe("default");
    expect(req.betas).toEqual(expect.arrayContaining(["thinking-binding-controls-2026-08-01", "server-side-fallback-2026-07-01"]));
    expect(req.output_config.effort).toBe("medium");
    expect(req.cache_control).toEqual({ type: "ephemeral" });
    // 返ってきた考えの記録（署名つき）を、そのまま会話に足す
    const done = events.at(-1) as Extract<AiEvent, { type: "done" }>;
    expect(done.messages[0].content).toEqual([thinking, { type: "text", text: "はい", citations: null }]);
  });

  it("道具の途中で考えの記録が返っても、次の問い合わせにそのまま入れる", async () => {
    const { calls } = await run([
      msg([thinking, { type: "tool_use", id: "t1", name: "echo", input: { q: "x" }, caller: { type: "direct" } }], "tool_use"),
      msg([{ type: "text", text: "終わり", citations: null }], "end_turn"),
    ]);
    const prev = calls[1].messages.at(-2) as { role: string; content: { type: string }[] };
    expect(prev.role).toBe("assistant");
    expect(prev.content[0]).toEqual(thinking);
  });

  it("断られた・長すぎて切れたときは、道具を使わずに止めて、そう伝える", async () => {
    const use = { type: "tool_use", id: "t1", name: "echo", input: { q: "x" }, caller: { type: "direct" } } as Message["content"][number];
    for (const [stop, words] of [
      ["refusal", "お答えできません"],
      ["max_tokens", "ここで止めました"],
    ] as const) {
      const { calls, events } = await run([msg([use], stop)]);
      expect(calls, stop).toHaveLength(1);
      expect(events.some((e) => e.type === "tool"), stop).toBe(false);
      expect(events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join(""), stop).toContain(words);
    }
  });
});

describe("AI の道具", () => {
  it("★ 管理者には金額の道具を渡さない。オーナーには渡す", () => {
    const names = (role: "owner" | "manager") => toolsFor({ ...ctx.user, role }).map((t) => t.name);
    expect(names("manager")).not.toContain("money_month");
    expect(names("owner")).toContain("money_month");
    expect(names("manager")).toEqual(expect.arrayContaining(["search", "list_events", "propose_reports", "propose_availability", "propose_activity", "propose_offers", "propose_events"]));
  });

  it("道具の入力の形は JSON Schema の object で渡す", () => {
    for (const d of toolDefinitions(toolsFor({ ...ctx.user, role: "owner" }))) {
      expect(d.input_schema.type, d.name).toBe("object");
      expect(d.input_schema).not.toHaveProperty("$schema");
      expect(d.description.length, d.name).toBeGreaterThan(10);
    }
  });
});

describe("画面から届く会話の確かめ", () => {
  const ok = (ms: unknown) => conversationSchema.safeParse(ms).success;
  it("利用者の発言で始まり、利用者の発言で終わる会話だけ受け付ける", () => {
    expect(ok([{ role: "user", content: "こんにちは" }])).toBe(true);
    expect(ok([{ role: "assistant", content: "x" }, { role: "user", content: "y" }])).toBe(false);
    expect(ok([{ role: "user", content: "x" }, { role: "assistant", content: "y" }])).toBe(false);
    expect(ok([])).toBe(false);
  });

  it("AI の答えに入っている考えの記録（署名つき）などは、中身を変えずに通す", () => {
    const ms = [
      { role: "user", content: "a" },
      { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "abc" }, { type: "fallback", from: { model: "x" }, to: { model: "y" } }, { type: "text", text: "b" }] },
      { role: "user", content: "c" },
    ];
    const r = conversationSchema.safeParse(ms);
    expect(r.success).toBe(true);
    expect(r.data).toEqual(ms);
  });

  it("利用者の発言に、AI の答えの形（考えの記録など）は入れられない", () => {
    expect(ok([{ role: "user", content: [{ type: "thinking", thinking: "x", signature: "y" }] }])).toBe(false);
  });

  it("画像は jpeg / png / webp / gif の base64 だけ。URL の画像や知らない形は受け付けない", () => {
    const img = (source: unknown) => [{ role: "user", content: [{ type: "image", source }] }];
    expect(ok(img({ type: "base64", media_type: "image/jpeg", data: "AAAA" }))).toBe(true);
    expect(ok(img({ type: "url", url: "https://example.com/a.png" }))).toBe(false);
    expect(ok(img({ type: "base64", media_type: "application/pdf", data: "AAAA" }))).toBe(false);
    expect(ok([{ role: "user", content: [{ type: "document", source: {} }] }])).toBe(false);
  });
});
