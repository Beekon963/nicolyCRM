import { expect, test } from "@playwright/test";
import { one, sql } from "../helpers/db";

/**
 * Phase 3-4: 月次締め（オーナーだけ）。
 * ほかのテストとぶつからないよう、現場のない4か月前の月に調整額だけを入れて、
 * 締める → 支払済みにする（元に戻す）→ ロック解除（理由は必須）→ もう一度締める、を確かめる。
 */
test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => isMobile, "締めの操作は PC で確かめる（スマホの表示は no-scroll で確認）");

let month = "";
let staff: { id: string; name: string };
const label = () => `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`;

async function clean() {
  const d = `${month}-01`;
  await sql(`delete from closing_logs where month = $1`, [d]);
  await sql(`delete from monthly_closings where month = $1`, [d]);
  await sql(`delete from payments where month = $1`, [d]);
  await sql(`delete from invoices where month = $1`, [d]);
  await sql(`delete from payment_adjustments where month = $1 and reason = 'E2E締めテスト'`, [d]);
}

// スマホの回はテストを飛ばすが、前後の処理は動くので、PC の回だけで準備・後片付けする
const isDesktop = () => !test.info().project.name.includes("mobile");

test.beforeAll(async () => {
  if (!isDesktop()) return;
  month = (await one<{ m: string }>(`select to_char(public.month_start(public.jst_today()) - interval '4 months', 'YYYY-MM') as m`)).m;
  staff = await one(`select id, name from staff where status = 'active' order by name limit 1`);
  await clean();
  await sql(`insert into payment_adjustments (staff_id, month, amount, reason) values ($1, $2, 5000, 'E2E締めテスト')`, [staff.id, `${month}-01`]);
});

test.afterAll(async () => {
  if (isDesktop()) await clean();
});

test("締める: チェックを確かめて締めると、締め済みになり支払いが「確定」になる", async ({ page }) => {
  await page.goto(`/money/closing?month=${month}`);
  await expect(page.getByRole("heading", { name: "まだ締めていません" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "締める前のチェック" })).toBeVisible();
  await expect(page.getByText("未承認の交通費・経費")).toBeVisible();
  await page.getByRole("button", { name: "この月を締める" }).click();
  await expect(page.getByText(`${label()}を締めました`)).toBeVisible();
  await expect(page.getByRole("heading", { name: "締め済み" })).toBeVisible();
  await expect(page.getByText(/が締めた$/)).toBeVisible();

  const mc = await one<{ status: string }>(`select status from monthly_closings where month = $1`, [`${month}-01`]);
  expect(mc.status).toBe("closed");
  const p = await one<{ status: string; net_amount: number }>(`select status, net_amount from payments where month = $1 and staff_id = $2`, [`${month}-01`, staff.id]);
  expect([p.status, p.net_amount]).toEqual(["confirmed", 5000]);
});

test("支払い: 締めた月は調整額を変えられず、支払済みにできる（元に戻せる）", async ({ page }) => {
  await page.goto(`/money/payments?month=${month}`);
  await expect(page.getByText("締め済み（締めた時点の金額）")).toBeVisible();
  const row = page.locator(`[id="s-${staff.id}"]`);
  await expect(row.getByText("確定（未払い）")).toBeVisible();
  await row.locator("summary").click();
  await expect(row.getByLabel("調整額（減らすときは −）")).toHaveCount(0);
  await expect(row.getByText("締め済みのため、調整額は変えられません")).toBeVisible();

  await page.getByRole("button", { name: "確定の1人を支払済みにする" }).click();
  await expect(page.getByText("1人を支払済みにしました")).toBeVisible();
  await expect(row.getByText(/^支払済 /)).toBeVisible();
  await expect(row.getByRole("button", { name: "支払済みを取り消す" })).toBeVisible();
  expect((await one<{ status: string }>(`select status from payments where month = $1 and staff_id = $2`, [`${month}-01`, staff.id])).status).toBe("paid");

  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(row.getByText("確定（未払い）")).toBeVisible();
  expect((await one<{ status: string }>(`select status from payments where month = $1 and staff_id = $2`, [`${month}-01`, staff.id])).status).toBe("confirmed");
});

test("ロック解除は理由が必須。解除したらもう一度締められ、履歴に残る", async ({ page }) => {
  await page.goto(`/money/closing?month=${month}`);
  await page.getByRole("button", { name: "ロックを解除する" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "ロックを解除する" }).click();
  await expect(page.getByText("ロックを解除する理由を入れてください")).toBeVisible();
  await dialog.getByLabel("理由（必須）").fill("テストのため");
  await dialog.getByRole("button", { name: "ロックを解除する" }).click();
  await expect(page.getByRole("heading", { name: "ロック解除中" })).toBeVisible();
  await expect(page.getByText("理由: テストのため").first()).toBeVisible();
  expect((await one<{ status: string }>(`select status from payments where month = $1 and staff_id = $2`, [`${month}-01`, staff.id])).status).toBe("unconfirmed");

  // 解除中は支払い画面に「ロック解除中」と出て、調整額を直せる
  await page.goto(`/money/payments?month=${month}`);
  await expect(page.getByText("ロック解除中（いまのデータで計算した金額）")).toBeVisible();

  await page.goto(`/money/closing?month=${month}`);
  await page.getByRole("button", { name: "もう一度締める" }).click();
  await expect(page.getByRole("heading", { name: "締め済み" })).toBeVisible();
  await expect(page.getByText(/もう一度締めた$/)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "ロックを解除した" })).toContainText("理由: テストのため");
});

test("まだ終わっていない月は締められない", async ({ page }) => {
  await page.goto("/money/closing");
  await expect(page.getByText(/この月はまだ終わっていません。/)).toBeVisible();
  await expect(page.getByRole("button", { name: "この月を締める" })).toBeDisabled();
});
