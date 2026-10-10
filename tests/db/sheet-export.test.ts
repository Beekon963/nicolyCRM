/**
 * 稼働表のスプレッドシートへの書き出し（Phase 1.5）。ローカルの DB を読み、Google 側は偽物のサーバーで受ける。
 */
import { generateKeyPairSync } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SENTINELS } from "../../scripts/seed/constants.mts";
import { closePool, getPool, localSupabase } from "./helpers";

afterAll(closePool);

const SHEET_ID = "TEST_SHEET_ID_0123456789abcdef";
let calls: { url: string; method: string; body: unknown }[] = [];
let sheetsStatus = 200;

beforeAll(() => {
  const s = localSupabase() as { API_URL: string; SECRET_KEY: string };
  process.env.NEXT_PUBLIC_SUPABASE_URL = s.API_URL;
  process.env.SUPABASE_SECRET_KEY = s.SECRET_KEY;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: "export@test-project.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  });
  // Google だけ偽物で受け、Supabase への通信はそのまま通す
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://oauth2.googleapis.com/")) return Response.json({ access_token: "ya29.test" });
    if (url.startsWith("https://sheets.googleapis.com/")) {
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      if (sheetsStatus !== 200) return Response.json({}, { status: sheetsStatus });
      return Response.json(url.includes("?fields=sheets.properties.title") ? { sheets: [] } : {});
    }
    return real(input, init);
  });
});

afterEach(async () => {
  calls = [];
  sheetsStatus = 200;
  await getPool().query(`delete from public.settings where key = 'sheet_export'`);
  await getPool().query(`delete from public.sheet_exports where ran_at > now() - interval '10 minutes'`);
});

afterAll(() => vi.unstubAllGlobals());

async function run() {
  const { runSheetExport } = await import("@/lib/sheet-export");
  return runSheetExport("button");
}

describe("スプレッドシートへの書き出し", () => {
  it("今月と来月のタブを作って書き、記録を残す。金額・電話番号は書かない", async () => {
    await getPool().query(`insert into public.settings (key, value) values ('sheet_export', $1)`, [{ spreadsheet_id: SHEET_ID }]);
    const r = await run();
    expect(r.ok).toBe(true);
    const titles = calls.filter((c) => c.url.includes(":batchUpdate")).map((c) => (c.body as { requests: { addSheet: { properties: { title: string } } }[] }).requests[0].addSheet.properties.title);
    expect(titles).toHaveLength(2);
    expect(titles.every((t) => /^\d{6}$/.test(t))).toBe(true);
    expect(r.message).toBe(`${titles.join("・")} を書き出しました`);

    const written = calls.filter((c) => c.method === "PUT").map((c) => (c.body as { values: string[][] }).values);
    expect(written).toHaveLength(2);
    expect(written[0][1].slice(0, 4)).toEqual(["ランク", "名前", "最寄り駅", "曜日"]);
    expect(written[0].length).toBeGreaterThan(10);
    const all = JSON.stringify(written);
    for (const s of Object.values(SENTINELS)) expect(all).not.toContain(String(s));
    expect(all).not.toMatch(/090-0000-|¥|単価/);

    const log = (await getPool().query(`select ok, message, source from public.sheet_exports order by ran_at desc limit 1`)).rows[0];
    expect(log).toEqual({ ok: true, message: r.message, source: "button" });
  });

  it("共有されていないときは、直し方を記録に残す", async () => {
    await getPool().query(`insert into public.settings (key, value) values ('sheet_export', $1)`, [{ spreadsheet_id: SHEET_ID }]);
    sheetsStatus = 403;
    const r = await run();
    expect(r).toEqual({ ok: false, message: "スプレッドシートに書き込めません。共有に export@test-project.iam.gserviceaccount.com を「編集者」で追加してください" });
  });

  it("書き出し先が未設定なら書き出さない", async () => {
    const r = await run();
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
