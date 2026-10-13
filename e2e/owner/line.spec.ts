import { createHmac } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { SEED_USERS } from "../../scripts/seed/constants.mts";
import { cleanupEvent, dropStaff, makeEvent, makeStaff, one, sql } from "../helpers/db";
import { expectNoHorizontalScroll } from "../helpers/layout";

/**
 * Phase 5: LINE 公式アカウントからの自動のお知らせ。本物の LINE には送らず、偽の LINE（e2e/mock-line.mjs）が受け取る。
 * スタッフがマイページから LINE とつなぐ → 本人が「参加できる」で確定 → 本人と社内に届く → 前日のお知らせ → 新しい現場は社内に届く
 */
// 設定（settings の line）を変えるので、PC のプロジェクトだけで順番に動かす
test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => isMobile, "LINE の設定は1つだけなので、PC のプロジェクトでまとめて確かめる");

const SECRET = "e2e-line-secret";
const MOCK = "http://127.0.0.1:4011";
const tag = Math.floor(Math.random() * 1e8).toString(16).padStart(8, "0");
const STAFF_LINE = `U${tag.repeat(4)}`;
const MANAGER_LINE = `U${[...tag].reverse().join("").repeat(4)}`;

type Sent = { path: string; to: string | string[] | null; replyToken: string | null; text: string };
const sentTo = async (who: string) => ((await (await fetch(`${MOCK}/__sent`)).json()) as Sent[]).filter((s) => s.to === who || (Array.isArray(s.to) && s.to.includes(who)));

async function webhook(request: APIRequestContext, events: unknown[], secret = SECRET) {
  const body = JSON.stringify({ destination: "Ubot", events });
  const signature = createHmac("sha256", secret).update(body).digest("base64");
  return request.post("/api/line/webhook", { data: body, headers: { "content-type": "application/json", "x-line-signature": signature } });
}
const cron = (request: APIRequestContext) => request.get("/api/cron/line", { headers: { authorization: "Bearer e2e-cron" } });

let before: unknown;
let started = "";
let staff: { id: string; name: string; token: string };
let ev: { id: string; venue: string; roleId: string };
let assignmentId = "";
const created: string[] = [];

test.beforeAll(async () => {
  started = (await one<{ t: string }>(`select now()::text as t`)).t;
  before = (await one<{ value: unknown }>(`select value from settings where key = 'line'`)).value;
  await sql(`update settings set value = '{"staffConfirm": true, "reminder": true, "reminderHour": 0, "adminNotify": true}' where key = 'line'`);
  // LINE とつなぐ人はこのテストで作る（ダミーデータの人をつなぐと、ほかのテストの確定でも LINE が送られてしまう）
  staff = await makeStaff("連携 一郎");
  ev = await makeEvent("public.jst_today() + 1", { required: 1 });
  assignmentId = (await one<{ id: string }>(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'offered') returning id`, [ev.id, staff.id, ev.roleId])).id;
  await sql(`update app_users set line_user_id = $1 where id = $2`, [MANAGER_LINE, SEED_USERS.manager.id]);
});

test.afterAll(async () => {
  await sql(`update settings set value = $1 where key = 'line'`, [JSON.stringify(before)]);
  await sql(`update app_users set line_user_id = null where id = $1`, [SEED_USERS.manager.id]);
  await sql(`delete from line_outbox where created_at >= $1`, [started]);
  for (const id of [ev.id, ...created]) await cleanupEvent(id);
  await dropStaff(staff?.id);
});

test("スタッフがマイページから LINE とつなぐ（コードを公式アカウントに送る）", async ({ browser, request }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });
  const guest = await ctx.newPage();
  await guest.goto(`/m/${staff.token}`);
  const card = guest.getByTestId("mypage-line");
  await card.getByRole("button", { name: "LINE とつなぐ" }).click();
  const code = (await card.getByTestId("line-code").textContent())!.trim();
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
  await expect(card.getByRole("link", { name: /友だち追加/ })).toHaveAttribute("href", "https://line.me/R/ti/p/%40nicoly-e2e");
  await expectNoHorizontalScroll(guest);

  // LINE から届いたことにする（署名が違うものは受け付けない）
  expect((await webhook(request, [{ type: "message", replyToken: "r-bad", source: { type: "user", userId: STAFF_LINE }, message: { type: "text", text: code } }], "wrong")).status()).toBe(401);
  const res = await webhook(request, [{ type: "message", replyToken: `r-${tag}`, source: { type: "user", userId: STAFF_LINE }, message: { type: "text", text: `連携コード ${code}` } }]);
  expect(res.status()).toBe(200);
  const replies = ((await (await fetch(`${MOCK}/__sent`)).json()) as Sent[]).filter((s) => s.replyToken === `r-${tag}`);
  expect(replies[0]?.text).toContain("つながりました");
  expect((await one<{ line_user_id: string }>(`select line_user_id from staff where id = $1`, [staff.id])).line_user_id).toBe(STAFF_LINE);

  await card.getByRole("button", { name: "送ったので確かめる" }).click();
  await expect(card.getByText("LINE とつながっています")).toBeVisible();
  await ctx.close();
});

test("本人が「参加できる」で確定すると、本人に確定連絡・社内に「確定」が LINE で届く", async ({ browser, request }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const guest = await ctx.newPage();
  await guest.goto(`/m/${staff.token}`);
  await guest.getByRole("button", { name: "参加できる" }).first().click();
  await expect(guest.getByText(/確定しました/).first()).toBeVisible();
  await ctx.close();

  expect((await cron(request)).status()).toBe(200);
  const toStaff = await sentTo(STAFF_LINE);
  expect(toStaff.some((s) => s.path.endsWith("/push") && s.text.includes(ev.venue))).toBe(true);
  const toTeam = await sentTo(MANAGER_LINE);
  expect(toTeam.some((s) => s.path.endsWith("/multicast") && s.text.includes("【確定】") && s.text.includes(staff.name) && s.text.includes("本人がマイページ"))).toBe(true);
  expect(toTeam.every((s) => !/円/.test(s.text))).toBe(true);
  const a = await one<{ sent: boolean }>(`select confirm_notice_sent_at is not null as sent from assignments where id = $1`, [assignmentId]);
  expect(a.sent).toBe(true);
});

test("前日のお知らせは、決めた時刻を過ぎたら1回だけ届く（確定のお知らせのあと）", async ({ request }) => {
  // 明日の現場で、送る時刻（0時）を過ぎているので、確定のときの定期実行で確定連絡のあとに届いている
  const reminders = async () => (await sentTo(STAFF_LINE)).filter((s) => s.path.endsWith("/push") && s.text.includes("明日"));
  await cron(request);
  await expect.poll(async () => (await reminders()).length).toBe(1);
  await cron(request);
  expect((await reminders()).length).toBe(1);
  const pushes = (await sentTo(STAFF_LINE)).filter((s) => s.path.endsWith("/push"));
  expect(pushes[0].text).toContain("確定しました");
  const a = await one<{ sent: boolean }>(`select reminder_sent_at is not null as sent from assignments where id = $1`, [assignmentId]);
  expect(a.sent).toBe(true);
});

test("新しい現場を作ると、社内（自分以外）に LINE で届く", async ({ page, request }) => {
  const date = (await one<{ d: string }>(`select to_char(public.jst_today() + 250 + floor(random() * 50)::int, 'YYYY-MM-DD') as d`)).d;
  await page.goto(`/events/new?date=${date}`);
  await page.getByLabel("取引先", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("会場", { exact: true }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "クローザーの必要人数を1増やす" }).click();
  await page.getByRole("button", { name: "現場を作る" }).click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
  created.push(page.url().split("/").at(-1)!);

  await cron(request);
  const toTeam = await sentTo(MANAGER_LINE);
  expect(toTeam.some((s) => s.text.startsWith("【新しい現場】1件（テスト オーナーさんが登録）"))).toBe(true);
});

test("「LINE の通知」の画面: 設定・つながっているスタッフ・送った記録が見られる", async ({ page }) => {
  await page.goto("/notifications");
  await expect(page.getByRole("heading", { name: "送るお知らせ（オーナー）" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "スタッフに確定のお知らせ" })).toBeChecked();
  await expect(page.getByRole("heading", { name: /LINE とつながっているスタッフ [1-9]\d*\// })).toBeVisible();
  await expect(page.getByText("社内に確定").first()).toBeVisible();
  await expect(page.getByText("送った").first()).toBeVisible();
  await expect(page.getByTestId("my-line").getByRole("button", { name: "LINE とつなぐ" })).toBeVisible();
});
