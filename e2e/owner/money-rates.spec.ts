import { expect, test } from "@playwright/test";
import { cleanupEvent, freeFutureDate, one, sql } from "../helpers/db";

/**
 * Phase 3-2: 単価の設定（オーナーだけ）。
 * テスト用の取引先と現場を作り、標準単価 → 現場の上書き → 見込みの金額が変わることを確かめる。
 */
test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => isMobile, "設定の保存は PC で確かめる（スマホの表示は no-scroll で確認）");

let clientId = "";
let eventId = "";
let assignmentId = "";
const name = `テスト請求先${Math.random().toString(36).slice(2, 7)}`;

test.beforeAll(async () => {
  clientId = (await one<{ id: string }>(`insert into companies (kind, name, status) values ('client', $1, 'active') returning id`, [name])).id;
  const closer = await one<{ id: string }>(`select id from roles where name = 'クローザー'`);
  const venue = await one<{ id: string }>(`select id from venues where is_active order by name limit 1`);
  const date = await freeFutureDate();
  eventId = (await one<{ id: string }>(`insert into events (client_id, venue_id, date, start_time, end_time) values ($1, $2, $3, '10:00', '19:00') returning id`, [clientId, venue.id, date])).id;
  await sql(`insert into event_requirements (event_id, role_id, required_count) values ($1, $2, 1)`, [eventId, closer.id]);
  const staff = await one<{ id: string }>(`select id from staff where status = 'active' order by name limit 1`);
  await sql(`insert into staff_private (staff_id, base_daily_rate) values ($1, 15000) on conflict (staff_id) do update set base_daily_rate = 15000`, [staff.id]);
  assignmentId = (await one<{ id: string }>(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed') returning id`, [eventId, staff.id, closer.id])).id;
});

test.afterAll(async () => {
  await sql(`delete from event_rates where event_id = $1`, [eventId]);
  await sql(`delete from event_incentive_rates where event_id = $1`, [eventId]);
  await cleanupEvent(eventId);
  await sql(`delete from client_rates where company_id = $1`, [clientId]);
  await sql(`delete from company_billing where company_id = $1`, [clientId]);
  await sql(`delete from companies where id = $1`, [clientId]);
});

test("取引先の標準単価を入れると、現場の見込みの請求額に出る", async ({ page }) => {
  await page.goto(`/sales/${clientId}`);
  const section = page.locator("section", { has: page.getByRole("heading", { name: "請求設定・標準単価（オーナーのみ）" }) }).last();
  await section.getByLabel("クローザー").first().fill("25000");
  await section.getByRole("button", { name: "標準単価を保存" }).click();
  await expect(page.getByText("標準単価を保存しました")).toBeVisible();
  await expect(section.getByLabel("クローザー").first()).toHaveValue("25,000");
  const saved = await one<{ amount: number }>(`select amount from client_rates where company_id = $1 and venue_id is null and kind = 'per_person_day'`, [clientId]);
  expect(saved.amount).toBe(25000);

  await section.getByRole("switch", { name: "交通費を請求に含める" }).click();
  await section.getByRole("button", { name: "請求設定を保存" }).click();
  await expect(page.getByText("請求設定を保存しました")).toBeVisible();

  await page.goto(`/events/${eventId}`);
  const money = page.locator("section", { has: page.getByRole("heading", { name: "単価（この現場だけ・オーナーのみ）" }) }).last();
  await expect(money.getByText("見込み", { exact: true })).toBeVisible();
  await expect(money.getByRole("definition").first()).toHaveText("25,000円");
  await expect(money.getByText("標準 25,000円（取引先）")).toBeVisible();
});

test("現場だけの単価・日当を上書きすると、見込みが変わる。空にすると標準に戻る", async ({ page }) => {
  await page.goto(`/events/${eventId}`);
  const money = page.locator("section", { has: page.getByRole("heading", { name: "単価（この現場だけ・オーナーのみ）" }) }).last();
  await money.getByLabel(/^クローザー/).first().fill("30,000");
  await money.locator('input[id^="event-daily-"]').first().fill("18000");
  await money.getByRole("button", { name: "この現場の単価を保存" }).click();
  await expect(page.getByText("この現場の単価を保存しました")).toBeVisible();
  await page.reload();
  await expect(money.getByRole("definition").first()).toHaveText("30,000円");
  // 報酬は上書きした日当 18,000
  await expect(money.getByRole("definition").nth(1)).toHaveText("18,000円");
  expect((await one<{ n: number }>(`select daily_rate_override as n from assignment_private where assignment_id = $1`, [assignmentId])).n).toBe(18000);

  await money.getByLabel(/^クローザー/).first().fill("");
  await money.getByRole("button", { name: "この現場の単価を保存" }).click();
  await expect(page.getByText("この現場の単価を保存しました")).toBeVisible();
  await page.reload();
  await expect(money.getByRole("definition").first()).toHaveText("25,000円");
});

test("管理者には、取引先の請求設定も現場の単価も出ない", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "e2e/.auth/manager.json" });
  const page = await ctx.newPage();
  await page.goto(`/sales/${clientId}`);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText("請求設定・標準単価")).toHaveCount(0);
  await page.goto(`/events/${eventId}`);
  await expect(page.getByText("必要人数").first()).toBeVisible();
  await expect(page.getByText("単価（この現場だけ")).toHaveCount(0);
  const r = await page.goto("/settings/money");
  expect(r?.status()).toBe(404);
  await ctx.close();
});

test("お金の設定: インセンティブ単価と税・源泉・支払日を保存できる", async ({ page }) => {
  const before = await sql<{ item_id: string; amount: number }>(`select item_id, amount from incentive_rates`);
  const beforeSettings = await sql<{ key: string; value: unknown }>(`select key, value from owner_settings where key in ('consumption_tax', 'withholding', 'payment_day')`);
  try {
    await page.goto("/settings/money");
    await expect(page.getByText("税理士に確認してください")).toBeVisible();
    await page.getByLabel("新規", { exact: true }).fill("3000");
    await page.getByRole("button", { name: "インセンティブ単価を保存" }).click();
    await expect(page.getByText("インセンティブ単価を保存しました")).toBeVisible();
    await page.getByLabel("報酬の支払日（翌月）").selectOption("25");
    await page.getByRole("button", { name: "税・源泉・支払日を保存" }).click();
    await expect(page.getByText("税・源泉・支払日の設定を保存しました")).toBeVisible();
    expect((await one<{ value: number }>(`select value from owner_settings where key = 'payment_day'`)).value).toBe(25);
  } finally {
    await sql(`delete from incentive_rates`);
    for (const r of before) await sql(`insert into incentive_rates (item_id, amount) values ($1, $2)`, [r.item_id, r.amount]);
    await sql(`delete from owner_settings where key = 'payment_day'`);
    for (const r of beforeSettings) await sql(`insert into owner_settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value`, [r.key, JSON.stringify(r.value)]);
  }
});
