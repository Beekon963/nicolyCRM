import { expect, type Page } from "@playwright/test";

/** 横スクロールが出ていないこと（要件 §6: スマホ幅 375px で横スクロールなし） */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `横スクロール ${overflow}px（${page.url()}）`).toBeLessThanOrEqual(0);
}

/** 一覧の検索結果（スマホはカード、PC は表）のリンク */
export function resultLinks(page: Page) {
  return page.getByRole("main").locator("li a:visible, tbody a:visible");
}

/** 一覧を検索して先頭を開く */
export async function openFirst(page: Page, listPath: string, q: string) {
  await page.goto(`${listPath}?q=${encodeURIComponent(q)}`);
  await resultLinks(page).first().click();
  await page.waitForLoadState("networkidle");
}
