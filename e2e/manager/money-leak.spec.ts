import { expect, test } from "@playwright/test";
import { openFirst, resultLinks } from "../helpers/layout";
import { recordResponses } from "../helpers/money";

/**
 * 受け入れテスト（要件 §10 Phase 1）:
 * 管理者でログインすると、金額が画面にも API レスポンスにも一切含まれない。
 * 新しい画面を作ったら PAGES に足すこと。
 */
const PAGES = [
  "/",
  "/?basis=reported",
  "/staff",
  "/venues",
  "/sales",
  "/sales?kind=partner",
  "/events",
  "/events?view=calendar",
  "/events/new",
  "/events/bulk",
  "/availability",
  "/results",
  "/results?show=all",
  "/expenses",
  "/expenses?status=approved",
  "/search?q=サンプル",
  "/more",
];

test("管理者が開くどの画面の通信にも金額・口座が含まれない", async ({ page }) => {
  test.setTimeout(120_000);
  const rec = recordResponses(page);
  for (const path of PAGES) {
    await page.goto(path);
    await page.getByRole("main").waitFor();
  }
  // 詳細画面（一覧の先頭を開く）
  for (const list of ["/staff", "/venues", "/sales", "/events"]) {
    await page.goto(list);
    await resultLinks(page).first().click();
    await page.waitForURL(new RegExp(`${list}/[^/?]+`));
    await page.waitForTimeout(300);
  }
  // 候補を探す
  await page.getByRole("link", { name: "候補を探す" }).click();
  await page.waitForURL(/\/candidates/);
  await page.getByText("並び順").waitFor();
  // 金額の目印を持つスタッフ（seed の1人目）の詳細
  await openFirst(page, "/staff", "090-0000-0001");
  await expect(page.getByText("お金・契約")).toHaveCount(0);

  expect(rec.count()).toBeGreaterThan(10);
  expect(rec.leaks()).toEqual([]);
});

