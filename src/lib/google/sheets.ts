import "server-only";
import { createSign } from "node:crypto";

/**
 * Google スプレッドシートへの書き込み（Phase 1.5 の自動書き出し）。
 * Google Cloud の「サービスアカウント」の鍵（JSON）を環境変数 GOOGLE_SERVICE_ACCOUNT_JSON に入れて使う。
 * 書き出し先のスプレッドシートは、サービスアカウントのメールアドレスに「編集者」で共有しておく。
 */

export type ServiceAccount = { client_email: string; private_key: string };

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

/** 画面に出せる日本語のエラー */
export class SheetError extends Error {}

/** 0 始まりの行・列 → 「H5」のような番地 */
export function a1(row: number, col: number): string {
  let c = col + 1;
  let letters = "";
  while (c > 0) {
    const m = (c - 1) % 26;
    letters = String.fromCharCode(65 + m) + letters;
    c = Math.floor((c - 1) / 26);
  }
  return `${letters}${row + 1}`;
}

export function readServiceAccount(raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON): ServiceAccount | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!j.client_email || !j.private_key) return null;
    // Vercel に貼ったときに改行が「\n」の文字になっていても読めるようにする
    return { client_email: j.client_email, private_key: j.private_key.replace(/\\n/g, "\n") };
  } catch {
    return null;
  }
}

/** スプレッドシートの URL か ID から ID を取り出す */
export function spreadsheetIdFrom(input: string): string | null {
  const s = input.trim();
  const m = s.match(/\/spreadsheets\/d\/([\w-]{20,})/);
  if (m) return m[1];
  return /^[\w-]{20,}$/.test(s) ? s : null;
}

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";

export async function getAccessToken(sa: ServiceAccount, fetchImpl: typeof fetch = fetch, now = Date.now(), scope = SHEETS_SCOPE): Promise<string> {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const iat = Math.floor(now / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope, aud: TOKEN_URL, iat, exp: iat + 3600 })}`;
  let sig: string;
  try {
    sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  } catch {
    throw new SheetError("サービスアカウントの鍵が読めません。GOOGLE_SERVICE_ACCOUNT_JSON に JSON ファイルの中身をそのまま入れてください");
  }
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  if (!res.ok) throw new SheetError("Google にログインできません。サービスアカウントの鍵が正しいか確認してください");
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new SheetError("Google にログインできません");
  return j.access_token;
}

export class SheetsClient {
  constructor(
    private token: string,
    private spreadsheetId: string,
    private serviceEmail: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(path: string, init: RequestInit = {}) {
    const res = await this.fetchImpl(`${API}/${encodeURIComponent(this.spreadsheetId)}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json", ...(init.headers ?? {}) },
    });
    if (res.status === 403) throw new SheetError(`スプレッドシートに書き込めません。共有に ${this.serviceEmail} を「編集者」で追加してください`);
    if (res.status === 404) throw new SheetError("書き出し先のスプレッドシートが見つかりません。URL を確認してください");
    if (!res.ok) throw new SheetError(`スプレッドシートに書き込めませんでした（${res.status}）`);
    return res.json() as Promise<Record<string, unknown>>;
  }

  async sheetTitles(): Promise<string[]> {
    const j = (await this.call("?fields=sheets.properties.title")) as { sheets?: { properties: { title: string } }[] };
    return (j.sheets ?? []).map((s) => s.properties.title);
  }

  /** タブの中身を、画面に見えている文字のまま読む（右端の空のマスは省かれるので、行の長さはそろえる） */
  async readValues(title: string): Promise<string[][]> {
    const range = encodeURIComponent(`'${title.replace(/'/g, "''")}'`);
    const j = (await this.call(`/values/${range}?valueRenderOption=FORMATTED_VALUE`)) as { values?: string[][] };
    const rows = (j.values ?? []).map((r) => r.map((v) => String(v ?? "")));
    const width = Math.max(0, ...rows.map((r) => r.length));
    return rows.map((r) => [...r, ...Array<string>(width - r.length).fill("")]);
  }

  /** タブの左上（A1）の文字（空なら ""） */
  async readA1(title: string): Promise<string> {
    const range = encodeURIComponent(`'${title.replace(/'/g, "''")}'!A1`);
    const j = (await this.call(`/values/${range}`)) as { values?: string[][] };
    return j.values?.[0]?.[0] ?? "";
  }

  /** タブを足す（1・2行目と左の4列を固定。今のシートと同じ） */
  async addSheet(title: string) {
    await this.call(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title, gridProperties: { frozenRowCount: 2, frozenColumnCount: 4 } } } }] }),
    });
  }

  /** マスをまとめて書く（書き戻し。Phase 19）。value が "" なら空にする */
  async writeCells(title: string, cells: { row: number; col: number; value: string }[]) {
    if (!cells.length) return;
    const t = `'${title.replace(/'/g, "''")}'`;
    await this.call(`/values:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ valueInputOption: "RAW", data: cells.map((c) => ({ range: `${t}!${a1(c.row, c.col)}`, values: [[c.value]] })) }),
    });
  }

  /** タブの中身を入れ替える（いったん消してから書く） */
  async replaceValues(title: string, values: string[][]) {
    const range = encodeURIComponent(`'${title.replace(/'/g, "''")}'`);
    await this.call(`/values/${range}:clear`, { method: "POST", body: "{}" });
    await this.call(`/values/${range}!A1?valueInputOption=RAW`, { method: "PUT", body: JSON.stringify({ values }) });
  }
}
