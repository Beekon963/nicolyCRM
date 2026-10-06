import { expect, test } from "@playwright/test";
import { openFirst } from "../helpers/layout";

const uniq = () => Math.random().toString(36).slice(2, 7);

test("新規登録のとき、基本日当にランクの基準日当が入る", async ({ page }) => {
  await page.goto("/staff/new");
  await page.getByLabel("ランク", { exact: true }).selectOption({ label: "B" });
  await expect(page.getByLabel(/基本日当（オーナーのみ/)).toHaveValue("16000");
  await page.getByLabel("氏名（必須）").fill(`日当 ${uniq()}`);
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByText("お金・契約（オーナーのみ）")).toBeVisible();
  await expect(page.getByLabel("基本日当")).toHaveValue("16000");
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
