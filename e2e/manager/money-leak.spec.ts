import { expect, test } from "@playwright/test";
import { openFirst, resultLinks } from "../helpers/layout";
import { recordResponses } from "../helpers/money";

/**
 * 受け入れテスト（要件 §10 Phase 1）:
 * 管理者でログインすると、金額が画面にも API レスポンスにも一切含まれない。
 * 新しい画面を作ったら PAGES に足すこと。
 */
const PAGES = ["/", "/staff", "/venues", "/sales", "/sales?kind=partner", "/more"];

test("管理者が開くどの画面の通信にも金額・口座が含まれない", async ({ page }) => {
  const rec = recordResponses(page);
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  // 詳細画面（一覧の先頭を開く）
  for (const list of ["/staff", "/venues", "/sales"]) {
    await page.goto(list);
    await resultLinks(page).first().click();
    await page.waitForLoadState("networkidle");
  }
  // 金額の目印を持つスタッフ（seed の1人目）の詳細
  await openFirst(page, "/staff", "090-0000-0001");
  await expect(page.getByText("お金・契約")).toHaveCount(0);

  expect(rec.count()).toBeGreaterThan(10);
  expect(rec.leaks()).toEqual([]);
});

