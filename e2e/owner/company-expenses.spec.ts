import { expect, test } from "@playwright/test";
import { SEED_USERS } from "../../scripts/seed/constants.mts";
import { letters, one, sql } from "../helpers/db";
import { expectNoHorizontalScroll, gotoReady } from "../helpers/layout";

/**
 * Phase 16: 会社の経費（オーナーだけ）。
 * - レシートを撮ると AI（画面テストでは偽の AI）が日付・店・金額・区分を入れる → 確かめて登録
 * - 手で入れる（金額 → 区分 → 店）。「元に戻す」で取り消せる
 * - 直す・取り消す・元に戻す
 * - 今のスプレッドシートの CSV を取り込む（シートの合計と同じか確かめる。2回目は増えない）・CSV に書き出す
 * - 管理者には画面もメニューも出ない
 * お店の名前はテストごとに変える（スマホと PC のテストが同時に動くので）
 */

// 偽の AI が返すレシート（e2e/mock-anthropic.mjs）
const MOCK = { vendor: "テスト食堂 駅前店", amount: "2,750" };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const today = async () => (await one<{ d: string }>(`select to_char(public.jst_today(), 'YYYY-MM-DD') as d`)).d;
const rowsOf = (tag: string) =>
  sql<{ id: string; amount: number; category: string; vendor: string; paid_by: string | null; receipt_path: string | null; voided: boolean }>(
    `select id, amount, category, vendor, paid_by, receipt_path, voided_at is not null as voided from company_expenses where vendor like '%' || $1 || '%' or item like '%' || $1 || '%' order by created_at`,
    [tag],
  );
/** テストで入れた経費を片付ける（画面からは消せないので、DB の管理者として消す） */
const cleanup = (tag: string) => sql(`delete from company_expenses where vendor like '%' || $1 || '%' or item like '%' || $1 || '%'`, [tag]);

test("レシートを撮ると AI が読み取って入れる。確かめて登録すると、一覧と合計に出る", async ({ page }) => {
  const tag = letters();
  try {
    await gotoReady(page, "/company-expenses/new");
    await expectNoHorizontalScroll(page);
    await page.getByLabel("レシートを撮る").setInputFiles({ name: "receipt.png", mimeType: "image/png", buffer: PNG });
    await expect(page.getByText("AI が読み取りました")).toBeVisible();
    await expect(page.getByLabel("金額（税込・必須）")).toHaveValue(MOCK.amount);
    await expect(page.getByLabel("店・支払先（必須）")).toHaveValue(MOCK.vendor);
    await expect(page.getByRole("button", { name: "飲食", pressed: true })).toBeVisible();
    // 飲食は参加者の欄が出る
    await page.getByLabel("参加者").fill("テスト オーナー、取引先2名");
    // ほかのテストと見分けるため、店の名前だけ変える
    await page.getByLabel("店・支払先（必須）").fill(`経費テスト食堂${tag}`);
    await page.getByRole("button", { name: "登録する" }).click();
    await expect(page.getByText("経費を入れました（2,750円）")).toBeVisible();
    // 続けて入れられるように空になる
    await expect(page.getByText("この画面で 1件入れました")).toBeVisible();
    await expect(page.getByLabel("金額（税込・必須）")).toHaveValue("");

    const [row] = await rowsOf(tag);
    expect(row).toMatchObject({ amount: 2750, category: "飲食", paid_by: SEED_USERS.owner.id, voided: false });
    // 写真は領収書として残る
    expect(row.receipt_path).toMatch(/^\d{4}-\d{2}\/[0-9a-f-]{36}\.jpg$/);

    await page.goto(`/company-expenses?month=${(await today()).slice(0, 7)}`);
    const item = page.getByRole("link", { name: new RegExp(`経費テスト食堂${tag}`) });
    await expect(item).toContainText("2,750円");
    await expect(item.getByLabel("領収書あり")).toBeVisible();
    await expect(page.getByRole("region", { name: "この月の合計" })).toContainText("払った人ごと");
    await expectNoHorizontalScroll(page);

    // 開くと写真が見られる
    await item.click();
    await expect(page.getByRole("img", { name: "領収書の写真" })).toBeVisible();
  } finally {
    await cleanup(tag);
  }
});

test("手で入れる: 金額 → 区分 → 店 → 登録。間違えたら「元に戻す」で取り消せる", async ({ page }) => {
  const tag = letters();
  try {
    await gotoReady(page, "/company-expenses/new");
    await page.getByLabel("金額（税込・必須）").fill("1,234");
    await page.getByRole("button", { name: "交通" }).click();
    await page.getByLabel("店・支払先（必須）").fill(`経費テストタクシー${tag}`);
    // 日付は今日、払った人は自分が最初から入っている
    await expect(page.getByLabel("日付", { exact: true })).toHaveValue(await today());
    await expect(page.getByRole("button", { name: "テスト オーナー", pressed: true })).toBeVisible();
    await page.getByRole("button", { name: "登録する" }).click();
    await expect(page.getByText("経費を入れました（1,234円）")).toBeVisible();
    expect(await rowsOf(tag)).toMatchObject([{ amount: 1234, category: "交通", voided: false, receipt_path: null }]);

    await page.getByRole("button", { name: "元に戻す" }).click();
    await expect(page.getByText("入れた経費を取り消しました")).toBeVisible();
    expect(await rowsOf(tag)).toMatchObject([{ voided: true }]);
    // 取り消した経費は一覧にも合計にも出ない
    await page.goto(`/company-expenses?month=${(await today()).slice(0, 7)}`);
    await expect(page.getByText(`経費テストタクシー${tag}`)).toHaveCount(0);
  } finally {
    await cleanup(tag);
  }
});

test("直す・取り消す・元に戻す", async ({ page }) => {
  const tag = letters();
  const day = await today();
  const { id } = await one<{ id: string }>(
    `insert into company_expenses (paid_by, spent_on, vendor, item, category, amount, created_by) values ($1, $2, $3, '打ち合わせ', '飲食', 3300, $1) returning id`,
    [SEED_USERS.owner.id, day, `経費テストカフェ${tag}`],
  );
  try {
    await gotoReady(page, `/company-expenses/${id}`);
    await expect(page.getByLabel("金額（税込・必須）")).toHaveValue("3,300");
    await page.getByLabel("金額（税込・必須）").fill("5000");
    await page.getByRole("button", { name: "保存する" }).click();
    await expect(page.getByText("直しました（5,000円）")).toBeVisible();
    await page.waitForURL(/\/company-expenses\?month=/);
    expect((await rowsOf(tag))[0].amount).toBe(5000);

    await gotoReady(page, `/company-expenses/${id}`);
    await page.getByRole("button", { name: "この経費を取り消す" }).click();
    await expect(page.getByText("取り消しました（合計に入りません）")).toBeVisible();
    await page.waitForURL(/\/company-expenses\?month=/);
    expect((await rowsOf(tag))[0].voided).toBe(true);
    await page.getByRole("button", { name: "元に戻す" }).click();
    await expect(page.getByText("元に戻しました")).toBeVisible();
    expect((await rowsOf(tag))[0].voided).toBe(false);
    await expect(page.getByText(`経費テストカフェ${tag}`)).toBeVisible();
  } finally {
    await cleanup(tag);
  }
});

test("今のスプレッドシートの CSV を取り込む: シートの合計と同じか確かめて入れる。2回目は増えない", async ({ page }) => {
  const tag = letters();
  const head = "日付,購入したもの・サービス,購入先・支払先,用途,区分,金額（税込・円）,領収書URL,メモ,参加者";
  const csv = Buffer.from(
    "﻿" +
      [
        "",
        "テスト オーナー｜経費記録",
        "",
        "合計金額（円）,記録件数",
        '"25,550",2 件',
        "",
        head,
        `2026/09/03,プリンター${tag},経費テスト家電${tag},事務所用,消耗品・備品,"¥24,100",https://example.com/r/1,,`,
        `2026/09/20,経費テスト食堂${tag},,,飲食,"¥1,450",,打ち合わせ,"山田、佐藤"`,
        "2026/09/12",
      ].join("\r\n"),
  );
  try {
    await gotoReady(page, "/company-expenses/import");
    await page.getByLabel("経費記録の CSV").setInputFiles({ name: "expenses.csv", mimeType: "text/csv", buffer: csv });
    const card = page.getByRole("region", { name: "読み込んだシート" }).getByRole("listitem").filter({ hasText: "テスト オーナー" });
    await expect(card).toContainText("2件・25,550円");
    await expect(card).toContainText("✓ シートの合計（25,550円）と同じ");
    // シートの名前から払った人を選んでいる。日付だけの行は入れない
    await expect(page.getByLabel("テスト オーナーのシートはだれが払った分か")).toHaveValue(SEED_USERS.owner.id);
    await expect(card).toContainText("入れない行 1件");
    await expectNoHorizontalScroll(page);
    await page.getByRole("region", { name: "取り込む内容" }).getByRole("button", { name: "2件を取り込む" }).click();
    await expect(page.getByRole("region", { name: "取り込みの結果" })).toContainText("2件の経費を入れました");
    const rows = await rowsOf(tag);
    expect(rows.map((r) => [r.amount, r.category, r.paid_by])).toEqual([
      [24100, "消耗品・備品", SEED_USERS.owner.id],
      [1450, "飲食", SEED_USERS.owner.id],
    ]);

    // もう一度取り込んでも増えない
    await page.getByLabel("経費記録の CSV").setInputFiles({ name: "expenses.csv", mimeType: "text/csv", buffer: csv });
    await page.getByRole("region", { name: "取り込む内容" }).getByRole("button", { name: "2件を取り込む" }).click();
    await expect(page.getByRole("region", { name: "取り込みの結果" })).toContainText("もう全部入っていました（同じ経費 2件は入れていません）");
    expect(await rowsOf(tag)).toHaveLength(2);

    // 2026年9月の分を CSV で書き出すと、取り込んだ経費が入っている
    const res = await page.request.get("/company-expenses/export?month=2026-09");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("日付,払った人,区分,店・支払先,購入したもの・サービス,用途,参加者,金額（税込・円）,メモ,領収書");
    expect(text).toContain(`2026/09/03,テスト オーナー,消耗品・備品,経費テスト家電${tag},プリンター${tag},事務所用,,24100,,https://example.com/r/1`);
  } finally {
    await cleanup(tag);
  }
});

test("経費のない月は、次にやることが出る", async ({ page }) => {
  await page.goto("/company-expenses?month=2001-01");
  await expect(page.getByText("この月の経費はまだありません")).toBeVisible();
  await expect(page.getByRole("link", { name: "レシートを撮って入れる" })).toBeVisible();
  await expect(page.getByRole("link", { name: "今のスプレッドシートから取り込む" })).toBeVisible();
});

test("管理者には会社の経費の画面もメニューも出ない（書き出しも 404）", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "e2e/.auth/manager.json" });
  const page = await ctx.newPage();
  const { id } = await one<{ id: string }>(`select id from company_expenses order by created_at limit 1`);
  for (const path of ["/company-expenses", "/company-expenses/new", "/company-expenses/import", `/company-expenses/${id}`, "/company-expenses/export?month=2026-10", "/company-expenses/export?year=2026"]) {
    const r = await page.goto(path);
    expect(r?.status(), path).toBe(404);
  }
  await page.goto("/more");
  await expect(page.getByRole("main").getByRole("link", { name: "会社の経費" })).toHaveCount(0);
  await ctx.close();
});
