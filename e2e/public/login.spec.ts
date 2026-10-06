import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll } from "../helpers/layout";

test("ログインしていないと管理画面はログイン画面へ移る", async ({ page }) => {
  await page.goto("/staff");
  await expect(page).toHaveURL(/\/login\?next=%2Fstaff/);
  await expect(page.getByRole("button", { name: "Google でログイン" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("登録されていないメールアドレスにはリンクを送らない", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill("nobody@example.com");
  await page.getByRole("button", { name: "ログイン用のリンクを受け取る" }).click();
  await expect(page.getByRole("status")).toContainText("登録されていません");
});

test("検索エンジンに載せない設定になっている", async ({ page, request }) => {
  await page.goto("/login");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  const robots = await request.get("/robots.txt");
  expect(await robots.text()).toContain("Disallow: /");
});
