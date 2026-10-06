import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll } from "../helpers/layout";

test("オーナーには設定などのメニューが出る", async ({ page }) => {
  await page.goto("/more");
  await expect(page.getByRole("main").getByRole("link", { name: "設定" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "変更履歴" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});
