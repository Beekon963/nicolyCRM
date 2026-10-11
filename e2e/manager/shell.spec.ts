import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll } from "../helpers/layout";

test("管理者にはオーナー専用のメニューが出ず、開いても見られない", async ({ page }) => {
  await page.goto("/more");
  await expect(page.getByRole("main").getByRole("link", { name: "会場" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "設定" })).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("link", { name: "変更履歴" })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  const res = await page.goto("/settings");
  expect(res?.status()).toBe(404);
});

test("管理者はデータ取り込み・変更履歴を開けない", async ({ page }) => {
  for (const path of ["/import", "/audit", "/settings/users"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
  }
});

test("管理者も研修の予約を使える（カレンダー連携の設定はオーナーだけ）", async ({ page }) => {
  await page.goto("/trainings");
  await expect(page.getByRole("button", { name: "研修の枠を作る" })).toBeVisible();
  await expect(page.getByRole("button", { name: "予約用リンク" })).toBeVisible();
  await expect(page.getByRole("button", { name: "カレンダー連携・設定" })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});
