import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * AI アシスタントの設定（Phase 4-4）。キーはサーバーだけで使う（NEXT_PUBLIC_ を付けない）。
 * - ANTHROPIC_API_KEY: Anthropic のキー（Vercel の環境変数に入れる）
 * - ANTHROPIC_MODEL: 使うモデルの名前。空なら、使えるモデルのうち一番新しい Opus（性能重視。なければ一番新しいもの）
 */

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function aiClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim(), maxRetries: 2 });
}

let cachedModel: string | null = null;

export async function resolveModel(client: Anthropic): Promise<string> {
  const fromEnv = process.env.ANTHROPIC_MODEL?.trim();
  if (fromEnv) return fromEnv;
  if (cachedModel) return cachedModel;
  // 新しく出たものから順に並んでいる
  const page = await client.models.list({ limit: 50 });
  const found = page.data.find((m) => /opus/i.test(m.id)) ?? page.data[0];
  if (!found) throw new Error("使えるモデルがありません");
  cachedModel = found.id;
  return cachedModel;
}

/** API のエラー → 画面のことば（細かい種類から順に見る） */
export function aiErrorMessage(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
    return "AI のキーが使えません。オーナーが Vercel の ANTHROPIC_API_KEY を確かめてください。";
  if (e instanceof Anthropic.NotFoundError) return "AI のモデルが見つかりません。オーナーが Vercel の ANTHROPIC_MODEL を確かめてください（ふだんは空でよい）。";
  if (e instanceof Anthropic.RateLimitError) return "AI の利用が上限に達したか、混み合っています。少し待ってからもう一度送ってください。";
  if (e instanceof Anthropic.BadRequestError) return "画像が大きすぎるか、会話が長くなりすぎました。「新しい会話」で始め直してください。";
  if (e instanceof Anthropic.APIUserAbortError) return "止めました。";
  if (e instanceof Anthropic.APIConnectionError || e instanceof Anthropic.InternalServerError) return "AI が混み合っています。少し待ってからもう一度送ってください。";
  if (e instanceof Anthropic.APIError && e.status === 413) return "画像が大きすぎます。枚数を減らしてください。";
  return "AI に聞けませんでした。少し待ってからもう一度送ってください。";
}
