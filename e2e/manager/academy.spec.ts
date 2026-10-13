import { expect, test } from "@playwright/test";
import { cleanupEvent, freeFutureDate, makeEvent, one, sql } from "../helpers/db";
import { expectNoHorizontalScroll } from "../helpers/layout";

/**
 * Phase 14: NICOLY アカデミーの進み具合を取り込む（管理者もできる。お金の情報はない）。
 * - アカデミーの管理画面の CSV を選ぶ → 名前の合うスタッフを自動で選ぶ → 取り込む
 * - スタッフの詳細（称号・分野のゲージ・稼働判断）・スタッフ一覧・打診の候補に札が出る
 * - 次に取り込むときは前と同じ人が選ばれ、いちばん新しい記録に置きかわる
 */
test.describe.configure({ mode: "serial" });

const T = Array.from({ length: 4 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
const NAME = `学習 ${T}`;
const LOGIN = `e2e-${T}`;
let staffId = "";
let eventId = "";

const HEAD = "ID,氏名,状態,ロードマップ,称号,携帯（章）,電気・ガス（章）,カード（章）,光（章）,端末（章）,知識テスト,総合ロープレ,現場チェック,稼働判断,ヒアリング評価,初回ガイド,最後に学習した日時";
const csv = (decision: string, title: string) =>
  Buffer.from("﻿" + [HEAD, `${LOGIN},${NAME},利用中,10/40,${title},8/8・テスト合格,1/6,0/5,0/7,0/9,合格,まだ,3/5,${decision},1,読了,2026/10/12 23:30`].join("\r\n") + "\r\n");

test.beforeAll(async () => {
  const closer = await one<{ id: string }>(`select id from roles where name = 'クローザー'`);
  staffId = (await one<{ id: string }>(`insert into staff (name, kana) values ($1, 'がくしゅう') returning id`, [NAME])).id;
  await sql(`insert into staff_roles (staff_id, role_id) values ($1, $2)`, [staffId, closer.id]);
  eventId = (await makeEvent(`'${await freeFutureDate()}'::date`, { required: 2 })).id;
});

test.afterAll(async () => {
  if (eventId) await cleanupEvent(eventId);
  await sql(`delete from academy_progress where staff_id = $1 or academy_id = $2`, [staffId, LOGIN]);
  await sql(`delete from staff_roles where staff_id = $1`, [staffId]);
  await sql(`delete from staff_private where staff_id = $1`, [staffId]);
  await sql(`delete from staff where id = $1`, [staffId]);
});

async function upload(page: import("@playwright/test").Page, buffer: Buffer, name = "nicoly-progress.csv") {
  await page.goto("/staff/academy");
  // 画面の準備（ファイルを選んだときの処理）ができてから渡す
  await page.waitForLoadState("networkidle");
  await page.getByLabel("アカデミーの CSV").setInputFiles({ name, mimeType: "text/csv", buffer });
}

test("アカデミーの CSV を取り込むと、スタッフの詳細に称号・分野・稼働判断が出る", async ({ page }) => {
  await upload(page, csv("稼働可", "携帯を案内できる"));
  await expect(page.getByText("受講者 1人")).toBeVisible();
  // はじめての人は名前が合うスタッフを選ぶ
  await expect(page.getByLabel(`${NAME}さんを CRM のだれにするか`)).toHaveValue(staffId);
  await expect(page.getByText("名前から選びました")).toBeVisible();
  await expect(page.getByText(`ログイン: ${LOGIN}`)).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.getByRole("region", { name: "取り込む内容" }).getByRole("button", { name: "1人を取り込む" }).click();
  await expect(page.getByRole("region", { name: "取り込みの結果" })).toContainText("1人のアカデミーの記録を入れました");

  await page.goto(`/staff/${staffId}`);
  const rec = page.getByRole("group", { name: "アカデミーの記録" });
  await expect(rec).toContainText("携帯を案内できる");
  await expect(rec).toContainText("稼働判断: 稼働可");
  await expect(rec.getByRole("meter", { name: "携帯の進み具合" })).toHaveAttribute("aria-valuenow", "8");
  await expect(rec.getByRole("meter", { name: "電気・ガスの進み具合" })).toHaveAttribute("aria-valuenow", "1");
  await expect(rec).toContainText("3 / 5項目");
  // 日本時間の 2026/10/12 23:30
  await expect(rec).toContainText("2026年10月12日");
  await expectNoHorizontalScroll(page);
});

test("スタッフ一覧と打診の候補に、称号と稼働判断の札が出る（並び順は変えない）", async ({ page }) => {
  await page.goto(`/staff?q=${encodeURIComponent(NAME)}`);
  await expect(page.getByRole("main").getByText("携帯を案内できる・稼働可").filter({ visible: true })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.goto(`/events/${eventId}/candidates`);
  const row = page.getByRole("main").getByRole("listitem").filter({ hasText: NAME });
  await expect(row).toContainText("携帯を案内できる・稼働可");
  await expectNoHorizontalScroll(page);
});

test("もう一度取り込むと前と同じ人が選ばれ、いちばん新しい記録に置きかわる", async ({ page }) => {
  await upload(page, csv("保留", "見習い"));
  await expect(page.getByLabel(`${NAME}さんを CRM のだれにするか`)).toHaveValue(staffId);
  await expect(page.getByText("前に取り込んだときと同じ人")).toBeVisible();
  await page.getByRole("region", { name: "取り込む内容" }).getByRole("button", { name: "1人を取り込む" }).click();
  await expect(page.getByRole("region", { name: "取り込みの結果" })).toContainText("1人のアカデミーの記録を入れました");

  await page.goto(`/staff/${staffId}`);
  const rec = page.getByRole("group", { name: "アカデミーの記録" });
  await expect(rec).toContainText("見習い");
  await expect(rec).toContainText("稼働判断: 保留");
  const n = await one<{ n: number }>(`select count(*)::int as n from academy_progress where staff_id = $1`, [staffId]);
  expect(n.n).toBe(1);
});

test("アカデミーの CSV でないファイルを選ぶと、どのファイルを選べばいいか出る", async ({ page }) => {
  await upload(page, Buffer.from("氏名,かな\n山田 太郎,やまだ たろう\n"), "staff.csv");
  await expect(page.getByText("アカデミーの進み具合の CSV ではないようです")).toBeVisible();
});
