import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, openFirst, resultLinks } from "../helpers/layout";

const uniq = () => Math.random().toString(36).slice(2, 7);

test("スタッフを かな・電話番号のハイフンなしで検索できる", async ({ page }) => {
  await page.goto("/staff");
  await expectNoHorizontalScroll(page);
  await page.getByLabel("絞り込み検索").fill("09000000001");
  await page.getByLabel("絞り込み検索").press("Enter");
  await expect(page).toHaveURL(/q=09000000001/);
  await expect(resultLinks(page)).toHaveCount(1);
  // かなはひらがなで登録されているが、カタカナでも見つかる（seed の 090-0000-0001 は 本田 直樹 / ほんだ なおき）
  await page.goto(`/staff?q=${encodeURIComponent("ホンダ ナオキ")}`);
  await expect(resultLinks(page)).toHaveCount(1);
  await expect(resultLinks(page).first()).toContainText("本田");
});

test("スタッフを登録し、NG・稼働履歴メモを追加できる", async ({ page }) => {
  const name = `テスト ${uniq()}`;
  await page.goto("/staff/new");
  await page.getByLabel("氏名（必須）").fill(name);
  await page.getByLabel("かな").fill("てすと");
  await page.getByRole("group", { name: "役割" }).getByRole("button", { name: "クローザー" }).click();
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expectNoHorizontalScroll(page);
  // 管理者には金額の欄が出ない
  await expect(page.getByText("お金・契約")).toHaveCount(0);

  await page.getByLabel("NG にする会場・取引先").selectOption({ index: 1 });
  await page.getByLabel("理由").fill("テスト");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect(page.getByText("NG に追加しました")).toBeVisible();
  await expect(page.getByText("会場NG")).toBeVisible();

  await page.getByLabel("内容").fill("遅刻の連絡あり");
  await page.getByLabel("種類").selectOption("late");
  await page.getByRole("button", { name: "メモを追加" }).click();
  await expect(page.getByText("遅刻の連絡あり")).toBeVisible();
});

test("マイページURLを再発行すると URL が変わる", async ({ page }) => {
  await openFirst(page, "/staff", "09000000002");
  const urlBox = page.getByTitle("タップでコピー");
  const before = await urlBox.textContent();
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "URLを再発行" }).click();
  await expect(page.getByText("再発行しました")).toBeVisible();
  await expect(urlBox).not.toHaveText(before ?? "");
});

test("会場を登録すると地図リンク付きで表示される", async ({ page }) => {
  const name = `テスト会場 ${uniq()}`;
  await page.goto("/venues/new");
  await page.getByLabel("会場名（必須）").fill(name);
  await page.getByLabel("住所（テレアポなどは空でよい）").fill("東京都千代田区丸の内1-0-0");
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.locator('a[href*="google.com/maps"]')).toContainText("東京都千代田区丸の内");
  await expectNoHorizontalScroll(page);
});

test("協力会社を次回アクションなしで保存しようとすると確認が出る", async ({ page }) => {
  const name = `株式会社テスト${uniq()}`;
  await page.goto("/sales/new?kind=partner");
  await page.getByLabel("会社名（必須）").fill(name);
  let asked = "";
  page.once("dialog", (d) => {
    asked = d.message();
    void d.dismiss();
  });
  await page.getByRole("button", { name: "登録する" }).click();
  await expect.poll(() => asked).toContain("次回アクション日");
  // 入力に戻って「明日」を選び、やることを書いて保存
  await page.getByRole("button", { name: "明日" }).click();
  await page.getByLabel("次にやること").fill(`${name} に電話`);
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByRole("main").getByText(`${name} に電話`).filter({ visible: true }).first()).toBeVisible();
});
