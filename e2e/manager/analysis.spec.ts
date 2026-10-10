import { expect, test } from "@playwright/test";

/** 実績の分析（Phase 2）。ダミーデータの過去2か月分の実績で確かめる */
test("スタッフ別・会場別・取引先別に、獲得件数と1稼働あたりが出る", async ({ page, isMobile }) => {
  await page.goto("/analysis?range=3m");
  await expect(page.getByRole("heading", { name: "実績の分析" })).toBeVisible();
  await expect(page.getByText(/獲得件数 [1-9]\d*件（確定）/)).toBeVisible();

  const first = isMobile ? page.locator("ol > li").first() : page.locator("tbody > tr").first();
  await expect(first).toContainText(/\d+/);
  await expect(isMobile ? first.getByText(/1稼働あたり/) : page.getByRole("columnheader", { name: "1稼働あたり" })).toBeVisible();

  await page.getByRole("link", { name: "会場別" }).click();
  await expect(page).toHaveURL(/by=venue/);
  await expect(isMobile ? page.locator("ol > li").first().getByText(/現場 \d+件/) : page.getByRole("columnheader", { name: "現場" })).toBeVisible();

  await page.getByRole("link", { name: "速報" }).click();
  await expect(page).toHaveURL(/basis=reported/);
  await expect(page.getByText(/（速報）/)).toBeVisible();

  await page.getByRole("link", { name: "取引先別" }).click();
  const link = isMobile ? page.locator("ol > li a").first() : page.locator("tbody a").first();
  await expect(link).toHaveAttribute("href", /^\/sales\//);
});

test("ホームの「今月の獲得件数」から分析へ進める", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "くわしく" }).click();
  await expect(page).toHaveURL(/\/analysis$/);
});
