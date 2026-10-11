import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll } from "../helpers/layout";

test("オーナーには設定などのメニューが出る", async ({ page }) => {
  await page.goto("/more");
  await expect(page.getByRole("main").getByRole("link", { name: "設定" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "変更履歴" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("ない画面を開くと、日本語の「ページが見つかりません」と戻り先が出る（英語の決まり文句は出さない）", async ({ page }) => {
  // ログイン中: メニューはそのまま、真ん中に案内
  await page.goto("/events/00000000-0000-0000-0000-000000000000");
  await expect(page.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "ホームへ" })).toBeVisible();
  await expect(page.getByText("could not be found")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  // どの画面にも当たらない URL
  const res = await page.goto("/no-such-page");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
  await expect(page.getByText("could not be found")).toHaveCount(0);
  await page.getByRole("link", { name: "トップへ" }).click();
  await expect(page.getByRole("heading", { name: "ホーム", exact: true })).toBeVisible();
});
