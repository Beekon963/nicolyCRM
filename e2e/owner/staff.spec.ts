import { expect, test } from "@playwright/test";
import { openFirst } from "../helpers/layout";

const uniq = () => Math.random().toString(36).slice(2, 7);

test("日当はランクで決まる: 新規登録では人ごとの日当は空のまま、スタッフの画面にランクの基準日当が出る（Phase 12）", async ({ page }) => {
  await page.goto("/staff/new");
  await page.getByLabel("ランク", { exact: true }).selectOption({ label: "B" });
  await expect(page.getByLabel(/人ごとの日当（オーナーのみ/)).toHaveValue("");
  await expect(page.getByText("空のときは、ランクの基準日当 16,000円")).toBeVisible();
  await page.getByLabel("氏名（必須）").fill(`日当 ${uniq()}`);
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByText("お金・契約（オーナーのみ）")).toBeVisible();
  await expect(page.getByLabel(/人ごとの日当/)).toHaveValue("");
  await expect(page.getByText("ランク B の基準日当 16,000円 で計算します")).toBeVisible();
});

test("インボイス登録番号の形式をチェックする", async ({ page }) => {
  await openFirst(page, "/staff", "09000000003");
  await page.getByLabel("インボイス登録番号").fill("T123");
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page.getByText("「T」＋13桁")).toBeVisible();
  await page.getByLabel("インボイス登録番号").fill("t-1234567890123");
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page.getByText("保存しました")).toBeVisible();
});
