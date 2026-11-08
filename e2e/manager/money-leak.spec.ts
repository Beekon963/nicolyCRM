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
  "/staff/academy",
  "/venues",
  "/sales",
  "/sales?kind=partner",
  "/sales?view=kanban",
  "/events",
  "/events?view=calendar",
  "/events/board",
  "/events/board?tab=day",
  "/events/board?tab=week",
  "/events/board?tab=month",
  "/events/new",
  "/events/bulk",
  "/jobs",
  "/jobs?view=kanban",
  "/jobs/new",
  "/availability",
  "/results",
  "/inbox",
  "/results/daily",
  "/results/convert",
  "/events/from-text",
  "/analysis",
  "/analysis?by=client&range=12m",
  "/results?show=all",
  "/expenses",
  "/expenses?status=approved",
  "/search?q=サンプル",
  "/trainings",
  "/notifications",
  "/more",
  // 会社の経費（オーナーだけ。管理者には「見つかりません」）
  "/company-expenses",
  "/company-expenses/new",
  "/company-expenses/import",
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
  // 稼働表（週）のマスを押したシートにも、現場の単価・日当（オーナーだけ）は出ない（Phase 22）
  await page.goto("/events/board?tab=week");
  await page.getByTestId("board-week").waitFor();
  let chip = page.locator('[data-testid="board-week"] [data-chip="confirmed"]').first();
  for (let i = 0; i < 5 && (await chip.count()) === 0; i++) {
    await page.getByRole("button", { name: "次の週" }).click();
    await page.getByTestId("board-week").waitFor();
    chip = page.locator('[data-testid="board-week"] [data-chip="confirmed"]').first();
  }
  await chip.locator("xpath=ancestor::button[1]").click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "この日の現場" })).toBeVisible();
  await expect(sheet.getByTestId("sheet-rate")).toHaveCount(0);
  await expect(sheet.getByText(/[\d,]+円/)).toHaveCount(0);
  await page.keyboard.press("Escape");

  expect(rec.count()).toBeGreaterThan(10);
  expect(rec.leaks()).toEqual([]);
});

