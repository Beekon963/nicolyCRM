import "server-only";
import { randomUUID } from "node:crypto";

/**
 * LINE 公式アカウント（Messaging API）。サーバーだけで使う。
 * - LINE_CHANNEL_ACCESS_TOKEN: チャネルアクセストークン（長期）。秘密
 * - LINE_CHANNEL_SECRET: チャネルシークレット（受け口の署名の確かめ）。秘密
 * - LINE_API_BASE: 画面テストのときだけ偽の LINE に向ける（ふだんは空）
 */

export function lineConfig(): { token: string; secret: string; base: string } | null {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  const secret = process.env.LINE_CHANNEL_SECRET?.trim();
  if (!token || !secret) return null;
  return { token, secret, base: process.env.LINE_API_BASE?.trim() || "https://api.line.me" };
}

export class LineApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
  /** 時間をおけば通るかもしれない（混雑・一時的な不具合） */
  get retryable() {
    return this.status === 429 || this.status >= 500;
  }
}

export type LineText = { type: "text"; text: string };

export class LineClient {
  constructor(
    private cfg: { token: string; base: string },
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(path: string, init: { method?: string; body?: unknown; retryKey?: string } = {}) {
    const res = await this.fetchImpl(`${this.cfg.base}${path}`, {
      method: init.method ?? "POST",
      headers: {
        authorization: `Bearer ${this.cfg.token}`,
        "content-type": "application/json",
        ...(init.retryKey ? { "x-line-retry-key": init.retryKey } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    // 同じ再送の鍵で、もう受け付け済み（二重送信にならない）
    if (res.status === 409 && init.retryKey) return {};
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new LineApiError(res.status, j?.message ?? `LINE に送れませんでした（${res.status}）`);
    }
    return (await res.json().catch(() => ({}))) as Record<string, unknown>;
  }

  /** 1人に送る */
  push(to: string, messages: LineText[], retryKey: string = randomUUID()) {
    return this.call("/v2/bot/message/push", { body: { to, messages }, retryKey });
  }

  /** 何人かに同じものを送る（500人まで） */
  multicast(to: string[], messages: LineText[], retryKey: string = randomUUID()) {
    return this.call("/v2/bot/message/multicast", { body: { to, messages }, retryKey });
  }

  /** 届いたメッセージに返事をする（無料。通数に数えない） */
  reply(replyToken: string, messages: LineText[]) {
    return this.call("/v2/bot/message/reply", { body: { replyToken, messages } });
  }

  /** 公式アカウントの情報（友だち追加のリンクに使う @ID） */
  async botInfo(): Promise<{ basicId: string; displayName: string }> {
    const j = (await this.call("/v2/bot/info", { method: "GET" })) as { basicId?: string; displayName?: string };
    return { basicId: j.basicId ?? "", displayName: j.displayName ?? "" };
  }
}

export const text = (t: string): LineText => ({ type: "text", text: t.slice(0, 4900) });

/** 友だち追加のリンク */
export const addFriendUrl = (basicId: string) => `https://line.me/R/ti/p/${encodeURIComponent(basicId)}`;
/** 公式アカウントへの文を入れた状態でトークを開くリンク */
export const sendTextUrl = (basicId: string, message: string) => `https://line.me/R/oaMessage/${encodeURIComponent(basicId)}/?${encodeURIComponent(message)}`;
