import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { type AiEvent, conversationSchema, runAgent } from "@/lib/ai/agent";
import { aiClient, aiConfigured, aiErrorMessage, resolveModel } from "@/lib/ai/config";
import { buildSystem } from "@/lib/ai/prompt";
import { toolDefinitions, toolsFor } from "@/lib/ai/tools";
import { getAppUser } from "@/lib/auth";
import { todayJst } from "@/lib/date";
import { createClient } from "@/lib/supabase/server";

/**
 * AI アシスタント（Phase 4-4）。ログイン中のオーナー・管理者だけ。
 * 会話を受け取り、Claude とのやりとりの途中経過を1行1つの JSON で返す（画面で少しずつ表示する）。
 * 道具はその人の権限（RLS）で使う。★ 管理者には金額の道具を渡さない。
 */
export const maxDuration = 120;

const MAX_BODY = 4_400_000;

export async function POST(req: Request) {
  const user = await getAppUser();
  if (!user) return Response.json({ error: "ログインし直してください" }, { status: 401 });
  if (!aiConfigured()) return Response.json({ error: "AI の設定（Anthropic のキー）がまだありません" }, { status: 503 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return Response.json({ error: "画像が大きすぎます。枚数を減らしてください" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "送り直してください" }, { status: 400 });
  }
  const parsed = conversationSchema.safeParse((body as { messages?: unknown })?.messages);
  if (!parsed.success) return Response.json({ error: "会話が長くなりすぎました。「新しい会話」で始め直してください" }, { status: 400 });

  const supabase = await createClient();
  const ctx = { supabase, user, today: todayJst() };
  const tools = toolsFor(user);
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AiEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          // 画面が閉じられた
        }
      };
      try {
        const client = aiClient();
        const [model, system] = await Promise.all([resolveModel(client), buildSystem(ctx)]);
        await runAgent({ client, model, system, tools, definitions: toolDefinitions(tools), ctx, messages: parsed.data as MessageParam[], send, signal: abort.signal });
      } catch (e) {
        send({ type: "error", message: aiErrorMessage(e) });
      } finally {
        try {
          controller.close();
        } catch {
          // すでに閉じている
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
