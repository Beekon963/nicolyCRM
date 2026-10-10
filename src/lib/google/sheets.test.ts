import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { getAccessToken, readServiceAccount, SheetError, SheetsClient, spreadsheetIdFrom } from "./sheets";

// テスト用にその場で作る鍵（本物ではない）
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const sa = { client_email: "export@test-project.iam.gserviceaccount.com", private_key: pem };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("サービスアカウントの鍵", () => {
  it("JSON ファイルの中身から読む。改行が「\\n」の文字でも読める", () => {
    expect(readServiceAccount(JSON.stringify(sa))).toEqual(sa);
    expect(readServiceAccount(JSON.stringify({ ...sa, private_key: pem.replace(/\n/g, "\\n") }))).toEqual(sa);
    expect(readServiceAccount("")).toBeNull();
    expect(readServiceAccount("{壊れた")).toBeNull();
    expect(readServiceAccount(JSON.stringify({ client_email: "x" }))).toBeNull();
  });

  it("スプレッドシートの URL から ID を取り出す", () => {
    expect(spreadsheetIdFrom("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789");
    expect(spreadsheetIdFrom("1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789")).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789");
    expect(spreadsheetIdFrom("https://example.com/")).toBeNull();
  });
});

describe("Google へのログイン", () => {
  it("署名した JWT でアクセストークンをもらう", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const assertion = new URLSearchParams(String(init?.body)).get("assertion")!;
      const [h, c, s] = assertion.split(".");
      const claims = JSON.parse(Buffer.from(c, "base64url").toString());
      expect(claims).toMatchObject({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", iat: 1_800_000_000, exp: 1_800_003_600 });
      expect(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, s, "base64url")).toBe(true);
      return json(200, { access_token: "ya29.test" });
    });
    await expect(getAccessToken(sa, fetchMock as unknown as typeof fetch, 1_800_000_000_000)).resolves.toBe("ya29.test");
  });

  it("ログインできないときは日本語で伝える", async () => {
    await expect(getAccessToken(sa, (async () => json(400, { error: "invalid_grant" })) as unknown as typeof fetch)).rejects.toThrow(SheetError);
    await expect(getAccessToken({ ...sa, private_key: "壊れた鍵" }, vi.fn() as unknown as typeof fetch)).rejects.toThrow(/鍵が読めません/);
  });
});

describe("スプレッドシートへの書き込み", () => {
  it("タブ名を読み、タブを足し、中身を消してから書く", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      if (String(url).endsWith("?fields=sheets.properties.title")) return json(200, { sheets: [{ properties: { title: "202610" } }] });
      return json(200, {});
    });
    const c = new SheetsClient("tok", "SHEET_ID_0123456789abc", sa.client_email, fetchMock as unknown as typeof fetch);
    expect(await c.sheetTitles()).toEqual(["202610"]);
    await c.addSheet("202611");
    await c.replaceValues("202611", [["a", "b"]]);
    expect(calls.map((x) => `${x.method} ${x.url.replace("https://sheets.googleapis.com/v4/spreadsheets/SHEET_ID_0123456789abc", "")}`)).toEqual([
      "GET ?fields=sheets.properties.title",
      "POST :batchUpdate",
      "POST /values/'202611':clear".replace("'202611'", encodeURIComponent("'202611'")),
      `PUT /values/${encodeURIComponent("'202611'")}!A1?valueInputOption=RAW`,
    ]);
    expect(calls[1].body).toEqual({ requests: [{ addSheet: { properties: { title: "202611", gridProperties: { frozenRowCount: 2, frozenColumnCount: 4 } } } }] });
    expect(calls[3].body).toEqual({ values: [["a", "b"]] });
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ authorization: "Bearer tok" });
  });

  it("共有されていない（403）・見つからない（404）ときは、直し方を日本語で伝える", async () => {
    const c403 = new SheetsClient("tok", "X".repeat(25), sa.client_email, (async () => json(403, {})) as unknown as typeof fetch);
    await expect(c403.sheetTitles()).rejects.toThrow(`共有に ${sa.client_email} を「編集者」で追加してください`);
    const c404 = new SheetsClient("tok", "X".repeat(25), sa.client_email, (async () => json(404, {})) as unknown as typeof fetch);
    await expect(c404.sheetTitles()).rejects.toThrow("見つかりません");
  });
});
