import { expect, type Page } from "@playwright/test";

/** 横スクロールが出ていないこと（要件 §6: スマホ幅 375px で横スクロールなし） */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `横スクロール ${overflow}px（${page.url()}）`).toBeLessThanOrEqual(0);
}
