import { expect, test } from "@playwright/test";
import { sql } from "../helpers/db";

/**
 * 稼働表のスプレッドシートへの書き出し（Phase 1.5）の画面。Google 側の設定（サービスアカウント）は
 * ローカルにはないので、設定がないことを画面で伝えるところまで確かめる（書き出しの中身は tests/db で確認）。
 */
test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => isMobile, "書き出し先の設定は1つだけなので、PC のプロジェクトで確かめる");

test.afterAll(async () => {
  await sql(`delete from settings where key = 'sheet_export'`);
  await sql(`delete from sheet_exports where ran_at > now() - interval '10 minutes'`);
});

test("オーナーが書き出し先を決め、今すぐ書き出すと結果が出る", async ({ page }) => {
  await sql(`delete from settings where key = 'sheet_export'`);
  await page.goto("/events/board");
  await page.getByRole("button", { name: "シートへの書き出し" }).click();
  const dialog = page.getByRole("dialog", { name: "シートへの書き出し" });
  await expect(dialog.getByText("書き出し先はまだ決まっていません")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "今すぐ書き出す" })).toBeDisabled();

  await dialog.getByLabel("書き出し先のスプレッドシートの URL").fill("https://example.com/");
  await dialog.getByRole("button", { name: "書き出し先を保存" }).click();
  await expect(page.getByText("スプレッドシートの URL を貼り付けてください")).toBeVisible();

  await dialog.getByLabel("書き出し先のスプレッドシートの URL").fill("https://docs.google.com/spreadsheets/d/E2E_TEST_SHEET_0123456789abc/edit#gid=0");
  await dialog.getByRole("button", { name: "書き出し先を保存" }).click();
  await expect(dialog.getByRole("link", { name: /書き出し先のスプレッドシートを開く/ })).toHaveAttribute("href", /E2E_TEST_SHEET_0123456789abc/);

  await dialog.getByRole("button", { name: "今すぐ書き出す" }).click();
  await expect(dialog.getByRole("status")).toContainText("Google のサービスアカウントが未設定です");
});

test("管理者は今すぐ書き出せるが、書き出し先は変えられない", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "e2e/.auth/manager.json" });
  const page = await ctx.newPage();
  await page.goto("/events/board");
  await page.getByRole("button", { name: "シートへの書き出し" }).click();
  const dialog = page.getByRole("dialog", { name: "シートへの書き出し" });
  await expect(dialog.getByRole("button", { name: "今すぐ書き出す" })).toBeEnabled();
  await expect(dialog.getByLabel("書き出し先のスプレッドシートの URL")).toHaveCount(0);
  await ctx.close();
});

test("自動実行の入り口は、合言葉（CRON_SECRET）がないと動かない", async ({ request }) => {
  const r = await request.get("/api/cron/sheet-export", { headers: { authorization: "Bearer wrong" } });
  expect(r.status()).toBe(401);
});
