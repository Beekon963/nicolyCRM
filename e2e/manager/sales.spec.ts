import { expect, type Page, test } from "@playwright/test";
import { one, sql } from "../helpers/db";

/**
 * 営業・追客（Phase 2、要件 §4.8・§10 Phase 2）。
 * テストごとに名前の違う会社を作り、終わったら消す（スマホと PC のテストが同時に動いてもぶつからない）
 */
const made: string[] = [];

async function makeCompany(o: { status?: string; due?: string | null; nextAction?: string; kind?: string } = {}) {
  const name = `テスト営業先${Math.random().toString(36).slice(2, 8)}`;
  const due = o.due === undefined ? `public.jst_today() - 400` : o.due;
  const c = await one<{ id: string }>(
    `insert into companies (kind, name, status, next_action_date, next_action, phone)
     values ($1, $2, $3, ${due ?? "null"}, $4, '03-0000-1234') returning id`,
    [o.kind ?? "partner", name, o.status ?? "contacted", o.nextAction ?? "折り返しの確認"],
  );
  made.push(c.id);
  return { id: c.id, name };
}

test.afterAll(async () => {
  if (!made.length) return;
  await sql(`delete from activities where company_id = any($1)`, [made]);
  await sql(`delete from contacts where company_id = any($1)`, [made]);
  await sql(`delete from companies where id = any($1)`, [made]);
});

async function recordFromSheet(page: Page, o: { result: string; memo: string; when: RegExp }) {
  const sheet = page.getByRole("dialog", { name: "活動を記録" });
  await expect(sheet.getByRole("button", { name: "架電", exact: true })).toHaveAttribute("aria-pressed", "true");
  await sheet.getByRole("button", { name: o.result, exact: true }).click();
  await sheet.getByLabel("一言メモ").fill(o.memo);
  await sheet.getByRole("button", { name: o.when }).click();
  await expect(sheet).toBeHidden();
}

test("ホームの「今日やること」から、架電の記録と次回アクションの設定ができ、元に戻せる", async ({ page }) => {
  const co = await makeCompany();
  await page.goto("/");
  const row = page.getByRole("listitem").filter({ hasText: co.name });
  await expect(row).toContainText("期限切れ");
  await row.getByRole("button", { name: `${co.name}の活動を記録` }).click();

  const started = Date.now();
  await recordFromSheet(page, { result: "折り返し待ち", memo: "担当者は会議中", when: /^3日後/ });
  expect(Date.now() - started).toBeLessThan(10_000);
  await expect(page.getByText(/記録しました（次回 .+ 折り返しがなければ電話する）/)).toBeVisible();
  await expect(row).toHaveCount(0);

  const saved = await one<{ status: string; d: number; next_action: string; n: number }>(
    `select status, next_action_date - public.jst_today() as d, next_action, (select count(*)::int from activities where company_id = $1) as n from companies where id = $1`,
    [co.id],
  );
  expect(saved).toEqual({ status: "contacted", d: 3, next_action: "折り返しがなければ電話する", n: 1 });

  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(page.getByText("記録を取り消しました")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: co.name })).toContainText("折り返しの確認");
  expect((await one<{ n: number }>(`select count(*)::int as n from activities where company_id = $1`, [co.id])).n).toBe(0);
});

test("会社の画面で記録すると活動履歴に残り、ステータスの候補も変わる", async ({ page }) => {
  const co = await makeCompany({ status: "not_contacted", due: null, nextAction: "" });
  await page.goto(`/sales/${co.id}`);
  await expect(page.getByText("未設定です。記録するときに次回アクション日を選んでください。")).toBeVisible();
  await expect(page.getByRole("link", { name: /03-0000-1234/ })).toHaveAttribute("href", "tel:0300001234");

  await page.getByRole("button", { name: `${co.name}の活動を記録` }).first().click();
  const sheet = page.getByRole("dialog", { name: "活動を記録" });
  await sheet.getByRole("button", { name: "アポ獲得", exact: true }).click();
  await expect(sheet.getByText("ステータスを「商談設定」に変えます")).toBeVisible();
  await expect(sheet.getByLabel("次にやること")).toHaveValue("商談する");

  // 必須なのに次回なしで記録しようとすると、入力を促す（もう一度押すと記録できる）
  await sheet.getByRole("button", { name: "次回なしで記録" }).click();
  await expect(sheet.getByRole("alert")).toContainText("次回アクション日が必要です");
  await sheet.getByRole("button", { name: "日付を指定する" }).click();
  await sheet.getByRole("button", { name: "この日で記録" }).click();
  await expect(sheet).toBeHidden();

  const history = page.getByRole("region", { name: /活動履歴/ }).or(page.locator("section", { has: page.getByRole("heading", { name: /活動履歴/ }) }));
  await expect(history.first()).toContainText("架電");
  await expect(history.first()).toContainText("アポ獲得");
  await expect(history.first()).toContainText("→ 商談設定");
});

test("次回アクション未設定の会社が一覧で分かり、絞り込める。カンバンでも見られる", async ({ page }) => {
  const co = await makeCompany({ status: "met", due: null, nextAction: "" });
  await page.goto("/sales?kind=partner");
  const row = page.getByRole("listitem").filter({ hasText: co.name });
  await expect(row.getByText("次回アクション未設定")).toBeVisible();

  await page.getByRole("combobox", { name: "次回アクション" }).selectOption("missing");
  await expect(page).toHaveURL(/next=missing/);
  await expect(page.getByRole("listitem").filter({ hasText: co.name })).toBeVisible();
  for (const li of await page.getByRole("listitem").all()) await expect(li.getByText("次回アクション未設定")).toBeVisible();

  await page.getByRole("link", { name: "カンバン" }).click();
  await expect(page).toHaveURL(/view=kanban/);
  const column = page.getByRole("region", { name: "商談済み" });
  await expect(column.getByRole("link", { name: new RegExp(co.name) })).toBeVisible();
  await expect(page.getByRole("region", { name: "未接触" })).toBeVisible();
});

test("スマホの ＋ から会社を選んで記録できる", async ({ page, isMobile }) => {
  test.skip(!isMobile, "右下の ＋ はスマホだけ");
  const co = await makeCompany({ due: "public.jst_today()" });
  await page.goto("/sales");
  await page.getByRole("button", { name: "作成" }).click();
  await page.getByRole("button", { name: "活動を記録", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "活動を記録" });
  await sheet.getByLabel("会社を探す").fill(co.name);
  await sheet.getByRole("button", { name: new RegExp(co.name) }).click();
  await recordFromSheet(page, { result: "つながった", memo: "来週また連絡", when: /^1週間後/ });
  const saved = await one<{ d: number }>(`select next_action_date - public.jst_today() as d from companies where id = $1`, [co.id]);
  expect(saved.d).toBe(7);
});
