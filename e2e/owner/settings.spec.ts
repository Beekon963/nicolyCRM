import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll } from "../helpers/layout";

const uniq = () => Math.random().toString(36).slice(2, 7);

test("エリアを追加して保存できる", async ({ page }) => {
  const name = `テストエリア${uniq()}`;
  await page.goto("/settings/masters/areas");
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "追加" }).click();
  await page.getByLabel("名前").last().fill(name);
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page.getByText("保存しました")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("名前").last()).toHaveValue(name);
});

test("文面テンプレートのプレビューに見本の値が入る", async ({ page }) => {
  await page.goto("/settings/templates");
  await expect(page.getByText("山田さん").first()).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("ユーザーを招待し、無効にできる", async ({ page }) => {
  const id = uniq();
  await page.goto("/settings/users");
  await page.getByRole("button", { name: "招待する" }).click();
  await page.getByLabel("名前").fill(`招待 ${id}`);
  await page.getByLabel("メールアドレス").fill(`invite-${id}@example.com`);
  await page.getByRole("dialog").getByRole("button", { name: "招待する" }).click();
  await expect(page.getByText(`招待 ${id}さんを招待しました`)).toBeVisible();

  page.on("dialog", (d) => d.accept());
  await page.getByRole("switch", { name: `招待 ${id}を有効にする` }).click();
  await expect(page.getByText("無効にしました")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: `招待 ${id}` }).getByText("無効")).toBeVisible();
});
