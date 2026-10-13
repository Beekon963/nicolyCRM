import { expect, test } from "@playwright/test";
import { cleanupEvent, one, sql } from "../helpers/db";
import { expectNoHorizontalScroll } from "../helpers/layout";

/**
 * Phase 13: 支払明細書（いただいた書式: 一覧 ＋ 一人ずつ）。PDF に保存（印刷）する。
 * ランク D（基準日当 14,000円）× 2日 → 合計 28,000 / 本体 25,454 / 源泉 2,598 / お支払額 25,402（本体価格 × 10.21%・控除なし）
 */
test.describe.configure({ mode: "serial" });

const T = Array.from({ length: 4 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
const NAME = `明細 ${T}`;
let staffId = "";
let month = "";
const events: string[] = [];

test.beforeAll(async () => {
  // 締めのテスト（4か月前）と重ならない、6か月前の月
  month = (await one<{ m: string }>(`select to_char(public.month_start(public.jst_today()) - interval '6 months', 'YYYY-MM') as m`)).m;
  const rate = await one<{ base_daily_rate: number }>(`select base_daily_rate from rank_rates where rank_id = (select id from ranks where name = 'D')`);
  expect(rate.base_daily_rate).toBe(14000);
  staffId = (await one<{ id: string }>(`insert into staff (name, kana, rank_id) values ($1, 'めいさい', (select id from ranks where name = 'D')) returning id`, [NAME])).id;
  const role = await one<{ id: string }>(`select id from roles where name = 'クローザー'`);
  for (const day of ["10", "11"]) {
    const ev = await one<{ id: string }>(
      `insert into events (client_id, venue_id, date, report_required)
       values ((select id from companies where kind = 'client' order by created_at limit 1), (select id from venues order by created_at limit 1), $1, false) returning id`,
      [`${month}-${day}`],
    );
    events.push(ev.id);
    await sql(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed')`, [ev.id, staffId, role.id]);
  }
});

test.afterAll(async () => {
  for (const e of events) await cleanupEvent(e);
  await sql(`delete from staff_private where staff_id = $1`, [staffId]);
  await sql(`delete from staff where id = $1`, [staffId]);
});

test("支払いから支払明細書を開き、一覧と一人ずつの明細書が書式どおりに出る（締め前は仮）", async ({ page }) => {
  await page.goto(`/money/payments?month=${month}`);
  await page.getByRole("link", { name: "支払明細書（PDF）" }).click();
  await page.waitForURL(/\/money\/statements\?month=/);
  const list = page.getByRole("region", { name: "支払一覧表" });
  await expect(list).toContainText("仮");
  await expectNoHorizontalScroll(page);

  // 一覧（PC は表、スマホはカード）
  const row = page.getByRole("row").filter({ hasText: NAME });
  const card = list.getByRole("listitem").filter({ hasText: NAME });
  const target = (await row.isVisible()) ? row : card;
  await expect(target).toContainText("14,000円");
  await expect(target).toContainText("28,000円");
  await expect(target).toContainText("2,598円");
  await expect(target).toContainText("25,402円");

  // 一人ずつの明細書
  await list.getByRole("link", { name: NAME }).click();
  const sheet = page.getByRole("region", { name: `${NAME}さんの支払明細書` });
  await expect(sheet).toContainText(`${NAME} 様`);
  await expect(sheet).toContainText("業務委託報酬（ランクD）");
  await expect(sheet).toContainText("うち 本体価格");
  await expect(sheet).toContainText("25,454円");
  await expect(sheet).toContainText("源泉徴収の対象額（本体価格）");
  await expect(sheet).toContainText("25,402円");
  await expect(sheet).toContainText("締め前の仮の明細書です");
  await expect(page.getByRole("button", { name: "PDF に保存（印刷）" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("全員分を開くと、一覧のあとに一人ずつの明細書が並ぶ（印刷で1人1枚）", async ({ page }) => {
  await page.goto(`/money/statements/all?month=${month}`);
  await expect(page.getByRole("region", { name: "支払一覧表" })).toBeVisible();
  await expect(page.getByRole("region", { name: `${NAME}さんの支払明細書` })).toContainText("お支払額");
  await expect(page.getByRole("button", { name: /全員分を PDF に保存/ })).toBeVisible();
});
