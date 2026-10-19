import { expect, test } from "@playwright/test";
import { dropStaff, makeStaff, one, sql } from "../helpers/db";
import { expectNoHorizontalScroll } from "../helpers/layout";

/**
 * Phase 4-4: AI アシスタント。本物の AI の代わりに偽の Anthropic（e2e/mock-anthropic.mjs）が決めた手順で答える。
 * 確かめること: 上の「AI」から開ける / AI が道具で CRM を調べられる / 画像を付けると確認カードが出て「登録する」で登録される
 */

// 1x1 の PNG（LINE のスクショの代わり）
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function openAi(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "AI アシスタント" }).click();
  return page.getByRole("dialog", { name: "AI アシスタント" });
}

test("AI に聞くと、CRM を調べて答える（スマホ幅で横スクロールしない）", async ({ page }) => {
  // 探す人はこのテストで作る（ほかのテストと同じ人を取り合わないように）
  const staff = await makeStaff("相談 一郎");
  try {
    const ai = await openAi(page);
    await expect(ai.getByText("このアプリのデータの質問")).toBeVisible();
    await expectNoHorizontalScroll(page);
    await ai.getByLabel("AI に送る文").fill(`探して:${staff.name}`);
    await ai.getByRole("button", { name: "送る" }).click();
    await expect(ai.getByText(/見つかった人: .*/)).toContainText(staff.name);
    await expect(ai.getByText("名前を探しています")).toBeVisible();
    await expectNoHorizontalScroll(page);

    // 同じ会話で続けて聞ける（前の答えの考えの記録をそのまま返している。違うと偽の AI が「設定がちがいます」と答える）
    await ai.getByLabel("AI に送る文").fill("道具");
    await ai.getByRole("button", { name: "送る" }).click();
    await expect(ai.getByText(/道具: /)).toBeVisible();
    await expect(ai.getByText(/設定がちがいます/)).toHaveCount(0);

    // 「新しい会話」で消える
    await ai.getByRole("button", { name: "新しい会話" }).click();
    await expect(ai.getByText(/見つかった人/)).toHaveCount(0);
  } finally {
    await dropStaff(staff.id);
  }
});

test("画像を付けて送ると確認カードが出て、「登録する」で稼働可能日が入る", async ({ page }) => {
  // 稼働可能日を入れる人はこのテストで作る
  const staff = await makeStaff("画像 一郎");
  const date = await one<{ d: string }>(`select to_char(public.jst_today() + 150, 'YYYY-MM-DD') as d`);
  try {
    const ai = await openAi(page);
    await ai.locator('input[type="file"]').setInputFiles({ name: "line.png", mimeType: "image/png", buffer: PNG });
    await expect(ai.getByRole("img", { name: "付けた画像" })).toBeVisible();
    await ai.getByLabel("AI に送る文").fill(`名前:${staff.name}`);
    await ai.getByRole("button", { name: "送る" }).click();

    const card = ai.getByTestId("ai-card");
    await expect(card.getByText("稼働可能日を入れる（1人）")).toBeVisible();
    await expect(card.getByText(staff.name, { exact: true })).toBeVisible();
    await expect(ai.getByText("確認カードを出しました")).toBeVisible();
    await expect(ai.getByText(/設定がちがいます/)).toHaveCount(0);
    // 押すまでは登録しない
    expect((await sql(`select 1 from availability where staff_id = $1 and date = $2`, [staff.id, date.d])).length).toBe(0);

    await card.getByRole("button", { name: "登録する" }).click();
    await expect(card.getByText("1人分の稼働可能日を入れました")).toBeVisible();
    const row = await one<{ status: string; source: string }>(`select status, source from availability where staff_id = $1 and date = $2`, [staff.id, date.d]);
    expect(row).toEqual({ status: "ok", source: "admin" });
  } finally {
    await dropStaff(staff.id);
  }
});

test("オーナーには金額を調べる道具も渡す", async ({ page }) => {
  const ai = await openAi(page);
  await ai.getByLabel("AI に送る文").fill("道具");
  await ai.getByRole("button", { name: "送る" }).click();
  await expect(ai.getByText(/道具: /)).toContainText("money_month");
});
