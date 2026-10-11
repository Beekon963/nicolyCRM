import { expect, test } from "@playwright/test";
import { cleanupEvent, freeFutureDate, makeEvent, one, sql } from "../helpers/db";

/**
 * Phase 4-1: 日報のフォーマット。オーナーが取引先ごとの書式を作り、実績確認の「日報」と
 * スタッフのマイページ（報告のあと）で、その書式の文章を LINE 用にコピーできる。
 */
test.describe.configure({ mode: "serial" });

let date = "";
let eventId = "";
let assignmentId = "";
let staff: { id: string; name: string; token: string };
let client: { id: string; name: string };
const tag = Math.random().toString(36).slice(2, 6);
/** 準備で作るフォーマット（日報・マイページの確認用）と、画面で作るフォーマット */
const FORMAT = `E2E日報${tag}`;
const FORMAT_UI = `E2E画面${tag}`;

test.beforeAll(async () => {
  date = await freeFutureDate();
  const ev = await makeEvent(`'${date}'::date`, { required: 1 });
  eventId = ev.id;
  client = await one(`select c.id, c.name from events e join companies c on c.id = e.client_id where e.id = $1`, [eventId]);
  staff = await one(`select id, name, mypage_token as token from staff where status = 'active' order by random() limit 1`);
  assignmentId = (await one<{ id: string }>(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed') returning id`, [eventId, staff.id, ev.roleId])).id;
  const item = await one<{ id: string }>(`select id from items where is_active order by sort_order limit 1`);
  await sql(`insert into reports (assignment_id, submitted_at, comment) values ($1, now(), 'E2Eのコメント')`, [assignmentId]);
  await sql(`insert into report_items (assignment_id, item_id, reported_count) values ($1, $2, 7)`, [assignmentId, item.id]);
  await sql(`insert into report_formats (name, company_id, for_staff, person_block) values ($1, $2, true, '{名前}さん 計{件数合計}件')`, [FORMAT, client.id]);
});

test.afterAll(async () => {
  await sql(`delete from report_formats where name in ($1, $2)`, [FORMAT, FORMAT_UI]);
  await cleanupEvent(eventId);
});

test("オーナー: 取引先用のフォーマットを作ると、プレビューが出て保存できる", async ({ page, isMobile }) => {
  test.skip(isMobile, "フォーマットの作成は PC で確かめる");
  await page.goto("/settings/report-formats");
  await expect(page.getByText("NICOLY用").first()).toBeVisible();
  await page.getByRole("button", { name: "新しいフォーマットを作る" }).click();
  const card = page.locator("details[open]").last();
  await card.getByLabel("名前", { exact: true }).fill(FORMAT_UI);
  await card.getByLabel("使う取引先").selectOption(client.id);
  await card.getByLabel("1人ごと", { exact: true }).fill("{名前}様 合計{件数合計}");
  await expect(card.getByText("山田様 合計")).toBeVisible();
  await card.getByRole("button", { name: "このフォーマットを作る" }).click();
  await expect(page.getByText("フォーマットを作りました")).toBeVisible();
  const saved = await one<{ company_id: string; person_block: string }>(`select company_id, person_block from report_formats where name = $1`, [FORMAT_UI]);
  expect(saved).toEqual({ company_id: client.id, person_block: "{名前}様 合計{件数合計}" });
});

test("実績確認の「日報」: その日の取引先ごとに、フォーマットの文章が出てコピーできる", async ({ page, isMobile }) => {
  test.skip(isMobile, "PC で確かめる（スマホの表示は no-scroll で確認）");
  await page.goto(`/results/daily?date=${date}`);
  const section = page.locator("section", { has: page.getByRole("heading", { name: new RegExp(client.name) }) });
  await expect(section.getByText(`${staff.name}さん 計7件`).first()).toBeVisible();
  await expect(section.getByText(FORMAT, { exact: true })).toBeVisible();
  await expect(section.getByRole("button", { name: "コピー" }).first()).toBeVisible();
});

test("スタッフのマイページ: 報告を送ったあと、その取引先のフォーマットで LINE 用にコピーできる", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`/m/${staff.token}/report/${assignmentId}`);
  await expect(page.getByRole("heading", { name: "LINE用にコピー（日報）" })).toBeVisible();
  await expect(page.getByText(`${staff.name}さん 計7件`).first()).toBeVisible();
  await expect(page.getByText("E2Eのコメント").first()).toBeVisible();
  await ctx.close();
});

test("管理者: 日報は使えるが、フォーマットの設定は開けない", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "e2e/.auth/manager.json" });
  const page = await ctx.newPage();
  await page.goto(`/results/daily?date=${date}`);
  await expect(page.getByText(`${staff.name}さん 計7件`).first()).toBeVisible();
  const r = await page.goto("/settings/report-formats");
  expect(r?.status()).toBe(404);
  await ctx.close();
});
