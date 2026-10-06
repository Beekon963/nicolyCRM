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
