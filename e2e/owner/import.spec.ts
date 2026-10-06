import { expect, test } from "@playwright/test";
import iconv from "./helpers-iconv";
import { one, sql } from "../helpers/db";
import { expectNoHorizontalScroll } from "../helpers/layout";

const uniq = () => Math.random().toString(36).slice(2, 7);

test("メンバー管理シート形式の CSV（Shift_JIS）でスタッフを取り込める", async ({ page }) => {
  const id = uniq();
  const phoneNew = `080-1${String(Math.floor(Math.random() * 1e3)).padStart(3, "0")}-${String(Math.floor(Math.random() * 1e4)).padStart(4, "0")}`;
  const csv = [
    "整理番号,名前,キャッチ力,クローザー力,立ち回り,知識,ランク,UPD_ID,電話番号,メールアドレス,口座情報,誓約書送付,受理",
    `1,取込 太郎${id},〇,◎,△,"docomo, au",ss,999,${phoneNew},dummy@example.com,ダミー銀行　駅前支店　普通　1234567,◯,〇`,
    `2,取込 花子${id},◎,〇,〇,docomo,D,998,,,,,`,
    `3,既存の人${id},〇,〇,〇,,A,997,090-0000-0005,,,,`,
    `4,エラー${id},,,,,Z,996,,,,,`,
  ].join("\r\n");
  await page.goto("/import");
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: /スタッフ名簿/ }).click();
  await page.getByLabel("CSV ファイル").setInputFiles({ name: "members.csv", mimeType: "text/csv", buffer: iconv(csv) });
  await expect(page.getByText("members.csv（4行）")).toBeVisible();
  await expect(page.getByLabel("氏名に入れる列")).toHaveValue("1");
  await page.getByRole("button", { name: "確認へ" }).click();

  await expect(page.getByText("取り込む 2行")).toBeVisible();
  await expect(page.getByText("重複候補 1行")).toBeVisible();
  await expect(page.getByText("エラー 1行（取り込みません）")).toBeVisible();
  await expect(page.getByText("ランク「Z」は設定にありません")).toBeVisible();
  await page.getByRole("button", { name: "2行を取り込む" }).click();
  await expect(page.getByText("取り込みが終わりました")).toBeVisible();
  await expect(page.getByText("新規 2件")).toBeVisible();

  const s = await one<{ id: string; memo: string; rank: string }>(
    `select s.id, s.memo, r.name as rank from staff s join ranks r on r.id = s.rank_id where s.name = $1`,
    [`取込 太郎${id}`],
  );
  expect(s.rank).toBe("SS");
  expect(s.memo).toContain("キャッチ力: 〇");
  expect(s.memo).toContain("メールアドレス: dummy@example.com");
  expect(s.memo).not.toContain("999"); // UPD_ID は取り込まない
  const priv = await one<{ bank_name: string; bank_branch: string; account_number: string; base_daily_rate: number }>(
    `select bank_name, bank_branch, account_number, base_daily_rate from staff_private where staff_id = $1`,
    [s.id],
  );
  const rankRate = await one<{ base_daily_rate: number }>(`select base_daily_rate from rank_rates rr join ranks r on r.id = rr.rank_id where r.name = 'SS'`);
  expect(priv).toEqual({ bank_name: "ダミー銀行", bank_branch: "駅前支店", account_number: "1234567", base_daily_rate: rankRate.base_daily_rate });
  const dup = await sql(`select id from staff where name = $1`, [`既存の人${id}`]);
  expect(dup).toHaveLength(0);

  // 変更履歴に残る
  await page.goto("/audit?table=staff_private");
  await expect(page.getByRole("main").getByRole("listitem").first()).toContainText("スタッフのお金・口座");
});

test("会場を UTF-8 の CSV で取り込める（重複は上書きを選べる）", async ({ page }) => {
  const id = uniq();
  const csv = `﻿店舗名,住所,最寄駅,エリア\r\nテスト会場${id},東京都千代田区0-0,東京駅,テストエリア${id}\r\n`;
  await page.goto("/import");
  await page.getByRole("button", { name: /会場/ }).click();
  await page.getByLabel("CSV ファイル").setInputFiles({ name: "venues.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "確認へ" }).click();
  await expect(page.getByText(`エリア「テストエリア${id}」を新しく作ります`)).toBeVisible();
  await page.getByRole("button", { name: "1行を取り込む" }).click();
  await expect(page.getByText("新規 1件")).toBeVisible();
  const v = await one<{ area: string }>(`select a.name as area from venues v join areas a on a.id = v.area_id where v.name = $1`, [`テスト会場${id}`]);
  expect(v.area).toBe(`テストエリア${id}`);
});

test("取引先を CSV で取り込める（「株式会社」の有無の違いは重複として出る）", async ({ page }) => {
  const id = uniq();
  const existing = await one<{ name: string }>(`select name from companies where kind = 'client' limit 1`);
  const csv = `会社名,電話番号,住所,担当者\r\nテスト取引${id}株式会社,03-0000-9999,東京都,佐藤\r\n${existing.name.replace("株式会社", "(株)")},,,\r\n`;
  await page.goto("/import");
  await page.getByRole("button", { name: /^取引先/ }).click();
  await page.getByLabel("CSV ファイル").setInputFiles({ name: "clients.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "確認へ" }).click();
  await expect(page.getByText("重複候補 1行")).toBeVisible();
  await page.getByRole("button", { name: "1行を取り込む" }).click();
  await expect(page.getByText("新規 1件")).toBeVisible();
  const c = await one<{ status: string; contact: string }>(
    `select c.status, ct.name as contact from companies c join contacts ct on ct.company_id = c.id where c.name = $1`,
    [`テスト取引${id}株式会社`],
  );
  expect(c).toEqual({ status: "active", contact: "佐藤" });
});
