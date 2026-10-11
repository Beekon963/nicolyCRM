import { expect, test } from "@playwright/test";

/** Phase 4-4: ★ 管理者の AI アシスタントには、金額を調べる道具を渡さない（偽の Anthropic が受け取った道具の名前を返す） */
test("管理者の AI には金額の道具が渡らない", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "AI アシスタント" }).click();
  const ai = page.getByRole("dialog", { name: "AI アシスタント" });
  await expect(ai.getByText("金額は答えません。")).toBeVisible();
  await ai.getByLabel("AI に送る文").fill("道具");
  await ai.getByRole("button", { name: "送る" }).click();
  const answer = ai.getByText(/道具: /);
  await expect(answer).toContainText("search");
  await expect(answer).toContainText("propose_reports");
  await expect(answer).not.toContainText("money_month");
});
