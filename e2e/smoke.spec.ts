import { expect, test } from "@playwright/test";

test("トップページが表示され、横スクロールが出ない", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "NICOLY CRM" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("検索エンジンに載せない設定になっている", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  const robots = await request.get("/robots.txt");
  expect(await robots.text()).toContain("Disallow: /");
});
