import { expect, test } from "@playwright/test";
import { one, sql } from "../helpers/db";

/** Phase 3-3: お金の画面（オーナーだけ）。ダミーデータの単価・実績で確かめる */
test("月次集計: 売上・支払・粗利（確定分と見込み分）と推移・取引先別が出る", async ({ page }) => {
  await page.goto("/money");
  await expect(page.getByRole("heading", { name: "お金" })).toBeVisible();
  await expect(page.getByText("売上（税抜）", { exact: true })).toBeVisible();
  await expect(page.getByText(/^確定 [\d,]+円/).first()).toBeVisible();
  await expect(page.getByText("売上（税抜）の推移")).toBeVisible();
  await expect(page.getByRole("heading", { name: "取引先別" })).toBeVisible();

  await page.getByRole("link", { name: "前の月" }).click();
  await expect(page).toHaveURL(/month=\d{4}-\d{2}/);
  await page.getByRole("button", { name: /合計/ }).last().focus();
  await expect(page.getByRole("status").filter({ hasText: "合計" })).toBeVisible();
});

test("請求: 取引先ごとの税込・税抜と、現場ごとの明細", async ({ page }) => {
  await page.goto("/money/invoices");
  const first = page.getByRole("listitem").filter({ has: page.locator("details") }).first();
  await expect(first).toContainText(/税抜 [\d,]+円 ＋ 消費税 [\d,]+円/);
  await first.locator("summary").click();
  await expect(first.getByText(/人日 /).first()).toBeVisible();
});

test.describe("支払い", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(({ isMobile }) => isMobile, "調整額の追加は PC で確かめる");

  test("スタッフごとの差引支払額と明細。調整額を足して消せる（理由は必須）", async ({ page }) => {
    await page.goto("/money/payments");
    const first = page.getByRole("listitem").filter({ has: page.locator("details") }).first();
    await expect(first).toContainText("差引支払額");
    const staffId = (await first.getAttribute("id"))!.slice(2);
    // 調整額を足すと並びが変わるので、スタッフの行は ID で選ぶ
    const row = page.locator(`[id="s-${staffId}"]`);
    await row.locator("summary").click();
    await expect(row.getByText("源泉の対象額")).toBeVisible();
    const month = new URL(page.url()).searchParams.get("month") ?? (await one<{ m: string }>(`select to_char(public.jst_today(), 'YYYY-MM') as m`)).m;
    try {
      await row.getByLabel("調整額（減らすときは −）").fill("-1500");
      await row.getByRole("button", { name: "追加" }).click();
      await expect(page.getByText("理由を入れてください")).toBeVisible();
      await row.getByLabel("調整の理由").fill("テスト用の調整");
      await row.getByRole("button", { name: "追加" }).click();
      await expect(page.getByText("調整額を追加しました")).toBeVisible();
      await expect(row.getByText("テスト用の調整")).toBeVisible();
      const adj = await one<{ amount: number }>(`select amount from payment_adjustments where staff_id = $1 and reason = 'テスト用の調整'`, [staffId]);
      expect(adj.amount).toBe(-1500);

      await row.locator("p", { hasText: "テスト用の調整" }).getByRole("button", { name: "この調整額を消す" }).click();
      await expect(page.getByText("調整額を消しました")).toBeVisible();
      await expect(row.getByText("テスト用の調整")).toHaveCount(0);
    } finally {
      await sql(`delete from payment_adjustments where reason = 'テスト用の調整' and month = $1::date`, [`${month}-01`]);
    }
  });
});

test("稼働表: オーナーには右端に売上・報酬の列と、その月の数字が出る", async ({ page }) => {
  // スマホは最初はリストなので、表を選んでおく
  await page.addInitScript(() => window.localStorage.setItem("nicoly.board.view", '"table"'));
  await page.goto("/events/board");
  await expect(page.getByRole("region", { name: /稼働表/ })).toBeVisible();
  await expect(page.getByText(/^売上・報酬/)).toBeAttached();
  await expect(page.getByRole("link", { name: "この月の数字（お金の画面へ）" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /^[\d,]+円$/ }).first()).toBeAttached();
  // マスの中に単価（今のシートの「単価」の行と同じ情報）
  await expect(page.getByText(/^¥[\d,]+(〜[\d,]+)?$/).first()).toBeAttached();
});

test("管理者はお金の画面を開けず、ホームにも今月の数字が出ない", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "e2e/.auth/manager.json" });
  const page = await ctx.newPage();
  for (const path of [
    "/money",
    "/money/invoices",
    "/money/payments",
    "/money/closing",
    "/money/export",
    "/money/export/file?kind=backup",
    "/money/statements",
    "/money/statements/all",
    "/settings/targets",
  ]) {
    const r = await page.goto(path);
    expect(r?.status(), path).toBe(404);
  }
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "今日やること（営業）" })).toBeVisible();
  await expect(page.getByText("今月の数字")).toHaveCount(0);
  // 稼働表にも金額の列・その月の数字は出ない（表で確かめる。スマホ幅は最初はリスト）
  await page.addInitScript(() => window.localStorage.setItem("nicoly.board.view", '"table"'));
  await page.goto("/events/board");
  await expect(page.getByRole("region", { name: /稼働表/ })).toBeVisible();
  await expect(page.getByText("売上・報酬")).toHaveCount(0);
  await expect(page.getByText("この月（オーナーのみ）")).toHaveCount(0);
  await expect(page.getByText(/^¥[\d,]+/)).toHaveCount(0);
  await ctx.close();
});

test("オーナーのホームに今月の数字が出る", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("今月の数字")).toBeVisible();
  await page.getByRole("link", { name: "お金へ" }).click();
  await expect(page).toHaveURL(/\/money$/);
});
