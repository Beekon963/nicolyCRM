import { createHmac } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { one, sql } from "../helpers/db";

/**
 * LINE で転送した文が受信箱に入る（Phase 18）。公式アカウントの受け口（webhook）に、つないだオーナーからの文を送る。
 * 受け口の文面は偽の LINE（e2e/mock-line.mjs）に届く。
 */
const SECRET = "e2e-line-secret";
const OWNER_LINE = `Uowner-inbox-${Math.random().toString(36).slice(2, 8)}`;

async function webhook(request: APIRequestContext, events: unknown[]) {
  const body = JSON.stringify({ destination: "Ubot", events });
  const signature = createHmac("sha256", SECRET).update(body).digest("base64");
  return request.post("/api/line/webhook", { data: body, headers: { "content-type": "application/json", "x-line-signature": signature } });
}

test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => isMobile, "受け口は1つなので、PC のプロジェクトで確かめる");

test.afterAll(async () => {
  await sql(`delete from line_inbox where text like 'E2E転送%'`);
  await sql(`update app_users set line_user_id = null where line_user_id = $1`, [OWNER_LINE]);
});

test("つないだオーナーから転送された文は受信箱に入り、画面で読み取れる。つないでいない人の文は入らない", async ({ page, request }) => {
  const owner = await one<{ id: string }>(`select id from app_users where role = 'owner' and is_active order by created_at limit 1`);
  await sql(`update app_users set line_user_id = $1 where id = $2`, [OWNER_LINE, owner.id]);
  const text = `E2E転送 参加できます！${Math.random().toString(36).slice(2, 6)}`;
  const res = await webhook(request, [{ type: "message", replyToken: "r-inbox", source: { type: "user", userId: OWNER_LINE }, message: { type: "text", text } }]);
  expect(res.status()).toBe(200);
  const sent = (await (await request.get("http://127.0.0.1:4011/__sent")).json()) as { replyToken: string | null; text: string }[];
  expect(sent.find((s) => s.replyToken === "r-inbox")?.text).toContain("LINE から入れる");

  // つないでいない人の文は入らない（返事もしない）
  await webhook(request, [{ type: "message", replyToken: "r-stranger", source: { type: "user", userId: "Ustranger" }, message: { type: "text", text: "E2E転送 だれ" } }]);
  expect((await one<{ n: number }>(`select count(*)::int as n from line_inbox where text = 'E2E転送 だれ'`)).n).toBe(0);

  await page.goto("/inbox");
  await expect(page.getByText("LINE から転送された文")).toBeVisible();
  await expect(page.getByText(text)).toBeVisible();
  await page.getByRole("button", { name: "読み取る" }).first().click();
  await expect(page.getByTestId("inbox-result")).toHaveAttribute("data-kind", "reply");
  await page.getByRole("button", { name: "済み" }).first().click();
  await expect.poll(async () => (await one<{ n: number }>(`select count(*)::int as n from line_inbox where text = $1 and done_at is not null`, [text])).n).toBe(1);
});
