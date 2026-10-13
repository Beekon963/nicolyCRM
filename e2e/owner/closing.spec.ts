import { expect, test } from "@playwright/test";
import { one, sql } from "../helpers/db";

/**
 * Phase 3-4: 月次締め（オーナーだけ）。
 * ほかのテストとぶつからないよう、現場のない4か月前の月に調整額だけを入れて、
 * 締める → 支払済みにする（元に戻す）→ ロック解除（理由は必須）→ もう一度締める、を確かめる。
 */
test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => isMobile, "締めの操作は PC で確かめる（スマホの表示は no-scroll で確認）");

let month = "";
let staff: { id: string; name: string };
const label = () => `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`;

async function clean() {
  const d = `${month}-01`;
  await sql(`delete from closing_logs where month = $1`, [d]);
  await sql(`delete from monthly_closings where month = $1`, [d]);
  await sql(`delete from payments where month = $1`, [d]);
  await sql(`delete from invoices where month = $1`, [d]);
  await sql(`delete from payment_adjustments where month = $1 and reason = 'E2E締めテスト'`, [d]);
}

// スマホの回はテストを飛ばすが、前後の処理は動くので、PC の回だけで準備・後片付けする
const isDesktop = () => !test.info().project.name.includes("mobile");

test.beforeAll(async () => {
  if (!isDesktop()) return;
  month = (await one<{ m: string }>(`select to_char(public.month_start(public.jst_today()) - interval '4 months', 'YYYY-MM') as m`)).m;
  staff = await one(`select id, name from staff where status = 'active' order by name limit 1`);
  await clean();
  await sql(`insert into payment_adjustments (staff_id, month, amount, reason) values ($1, $2, 5000, 'E2E締めテスト')`, [staff.id, `${month}-01`]);
});

test.afterAll(async () => {
  if (isDesktop()) await clean();
});

test("締める: チェックを確かめて締めると、締め済みになり支払いが「確定」になる", async ({ page }) => {
  await page.goto(`/money/closing?month=${month}`);
  await expect(page.getByRole("heading", { name: "まだ締めていません" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "締める前のチェック" })).toBeVisible();
  await expect(page.getByText("未承認の交通費・経費")).toBeVisible();
  await page.getByRole("button", { name: "この月を締める" }).click();
  await expect(page.getByText(`${label()}を締めました`)).toBeVisible();
  await expect(page.getByRole("heading", { name: "締め済み" })).toBeVisible();
  await expect(page.getByText(/が締めた$/)).toBeVisible();

  const mc = await one<{ status: string }>(`select status from monthly_closings where month = $1`, [`${month}-01`]);
  expect(mc.status).toBe("closed");
  const p = await one<{ status: string; net_amount: number }>(`select status, net_amount from payments where month = $1 and staff_id = $2`, [`${month}-01`, staff.id]);
  // 源泉は全員が対象（Phase 13）: 調整額 5,000円 → 本体価格 4,545円 × 10.21% = 464円 を引く（対象外の人なら 5,000円）
  const m = await one<{ method: string }>(`select coalesce((select withholding_method::text from staff_private where staff_id = $1), 'fee') as method`, [staff.id]);
  const net = m.method === "fee" ? 5000 - Math.floor((Math.floor((5000 * 100) / 110) * 1021) / 10000) : 5000;
  expect([p.status, p.net_amount]).toEqual(["confirmed", net]);
});

test("支払い: 締めた月は調整額を変えられず、支払済みにできる（元に戻せる）", async ({ page }) => {
  await page.goto(`/money/payments?month=${month}`);
  await expect(page.getByText("締め済み（締めた時点の金額）")).toBeVisible();
  const row = page.locator(`[id="s-${staff.id}"]`);
  await expect(row.getByText("確定（未払い）")).toBeVisible();
  await row.locator("summary").click();
  await expect(row.getByLabel("調整額（減らすときは −）")).toHaveCount(0);
  await expect(row.getByText("締め済みのため、調整額は変えられません")).toBeVisible();

  await page.getByRole("button", { name: "確定の1人を支払済みにする" }).click();
  await expect(page.getByText("1人を支払済みにしました")).toBeVisible();
  await expect(row.getByText(/^支払済 /)).toBeVisible();
  await expect(row.getByRole("button", { name: "支払済みを取り消す" })).toBeVisible();
  expect((await one<{ status: string }>(`select status from payments where month = $1 and staff_id = $2`, [`${month}-01`, staff.id])).status).toBe("paid");

  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect(row.getByText("確定（未払い）")).toBeVisible();
  expect((await one<{ status: string }>(`select status from payments where month = $1 and staff_id = $2`, [`${month}-01`, staff.id])).status).toBe("confirmed");
});

test("ロック解除は理由が必須。解除したらもう一度締められ、履歴に残る", async ({ page }) => {
  await page.goto(`/money/closing?month=${month}`);
  await page.getByRole("button", { name: "ロックを解除する" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "ロックを解除する" }).click();
  await expect(page.getByText("ロックを解除する理由を入れてください")).toBeVisible();
  await dialog.getByLabel("理由（必須）").fill("テストのため");
  await dialog.getByRole("button", { name: "ロックを解除する" }).click();
  await expect(page.getByRole("heading", { name: "ロック解除中" })).toBeVisible();
  await expect(page.getByText("理由: テストのため").first()).toBeVisible();
  expect((await one<{ status: string }>(`select status from payments where month = $1 and staff_id = $2`, [`${month}-01`, staff.id])).status).toBe("unconfirmed");

  // 解除中は支払い画面に「ロック解除中」と出て、調整額を直せる
  await page.goto(`/money/payments?month=${month}`);
  await expect(page.getByText("ロック解除中（いまのデータで計算した金額）")).toBeVisible();

  await page.goto(`/money/closing?month=${month}`);
  await page.getByRole("button", { name: "もう一度締める" }).click();
  await expect(page.getByRole("heading", { name: "締め済み" })).toBeVisible();
  await expect(page.getByText(/もう一度締めた$/)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "ロックを解除した" })).toContainText("理由: テストのため");
});

test("まだ終わっていない月は締められない", async ({ page }) => {
  await page.goto("/money/closing");
  await expect(page.getByText(/この月はまだ終わっていません。/)).toBeVisible();
  await expect(page.getByRole("button", { name: "この月を締める" })).toBeDisabled();
});

/** Phase 3-5: 書き出し。締めた月（上で締めた月）で、支払明細・freee・振込データ・全データを確かめる */
test("書き出し: 支払明細・freee・振込データ（全銀）・全データをダウンロードできる", async ({ page }) => {
  const before = await sql<{ value: unknown }>(`select value from owner_settings where key = 'zengin'`);
  const priv = await sql(`select bank_code, branch_code, account_type, account_number, account_holder_kana from staff_private where staff_id = $1`, [staff.id]);
  // ファイル名（日本語）はヘッダーで確かめる（この環境の Chromium は日本語のファイル名を「download」にしてしまうため）
  const read = async (name: RegExp) => {
    const href = (await page.getByRole("link", { name }).getAttribute("href"))!;
    const r = await page.request.get(href);
    expect(r.status()).toBe(200);
    const cd = r.headers()["content-disposition"] ?? "";
    expect(cd).toMatch(/^attachment; /);
    return { name: decodeURIComponent(cd.match(/filename\*=UTF-8''(.+)$/)?.[1] ?? ""), bytes: await r.body() };
  };
  try {
    await sql(`delete from owner_settings where key = 'zengin'`);
    await page.goto(`/money/export?month=${month}`);
    await expect(page.getByRole("heading", { name: "振込データ（全銀フォーマット・総合振込）" })).toBeVisible();
    await expect(page.getByText(/振込元が足りません/)).toBeVisible();

    // 押すとダウンロードになる
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /支払明細をダウンロード/ }).click()]);
    expect(dl.url()).toContain(`kind=payments&month=${month}`);

    // 支払明細（UTF-8 BOM 付き）
    const pay = await read(/支払明細をダウンロード/);
    expect(pay.name).toBe(`支払明細_${label()}.csv`);
    const payText = pay.bytes.toString("utf8");
    expect(payText.startsWith("﻿スタッフ,対象月")).toBe(true);
    expect(payText).toContain(`${staff.name},${month},,,,調整: E2E締めテスト`);

    // freee: 支出（外注費）の取引
    const freee = await read(/freee 用の CSV/);
    const freeeText = freee.bytes.toString("utf8");
    expect(freeeText.split("\r\n")[0]).toContain("収支区分,管理番号,発生日");
    expect(freeeText).toContain(`支出,`);
    expect(freeeText).toContain(`,${staff.name},外注費,`);

    // 振込データ: 振込元と口座を入れると入る（1行120バイト × 4行）
    await sql(
      `insert into owner_settings (key, value) values ('zengin', $1) on conflict (key) do update set value = excluded.value`,
      [JSON.stringify({ requesterCode: "1234567890", requesterName: "カ）テスト", bankCode: "0001", bankName: "", branchCode: "001", branchName: "", accountType: "ordinary", accountNumber: "1234567" })],
    );
    await sql(
      `insert into staff_private (staff_id, bank_code, branch_code, account_type, account_number, account_holder_kana) values ($1, '0005', '123', 'ordinary', '7654321', 'テスト タロウ')
       on conflict (staff_id) do update set bank_code = '0005', branch_code = '123', account_type = 'ordinary', account_number = '7654321', account_holder_kana = 'テスト タロウ'`,
      [staff.id],
    );
    await page.reload();
    await expect(page.getByText(/^1人・合計/)).toBeVisible();
    const zen = await read(/振込データをダウンロード/);
    expect(zen.name).toBe(`総合振込_${label()}.txt`);
    expect(zen.bytes.length).toBe(4 * 122);
    expect(zen.bytes.subarray(0, 4).toString("latin1")).toBe("1210");

    // 全データ: ZIP。マイページの鍵は入らない
    const zip = await read(/全データをダウンロード/);
    expect(zip.bytes.subarray(0, 2).toString("latin1")).toBe("PK");
    const { unzipSync, strFromU8 } = await import("fflate");
    const files = unzipSync(new Uint8Array(zip.bytes));
    const staffCsv = strFromU8(files["01_スタッフ.csv"]);
    expect(staffCsv).toContain(staff.name);
    expect(staffCsv).not.toContain("mypage_token");
    expect(Object.keys(files)).toContain("はじめにお読みください.txt");
    // 研修の予約の控えの鍵も入らない
    const bookings = Object.entries(files).find(([n]) => n.endsWith("_研修の予約.csv"));
    expect(bookings).toBeTruthy();
    expect(strFromU8(bookings![1])).not.toContain("cancel_token");
  } finally {
    await sql(`delete from owner_settings where key = 'zengin'`);
    if (before[0]) await sql(`insert into owner_settings (key, value) values ('zengin', $1)`, [JSON.stringify(before[0].value)]);
    const p = priv[0] as Record<string, unknown> | undefined;
    await sql(
      `update staff_private set bank_code = $2, branch_code = $3, account_type = $4, account_number = $5, account_holder_kana = $6 where staff_id = $1`,
      [staff.id, p?.bank_code ?? null, p?.branch_code ?? null, p?.account_type ?? null, p?.account_number ?? "", p?.account_holder_kana ?? ""],
    );
  }
});

// 振込元の設定は上の書き出しのテストと同じものを使うので、同じファイルで順番に動かす
test("お金の設定: freee の勘定科目と、振込データの振込元を保存できる（番号の桁はチェックする）", async ({ page }) => {
  const before = await sql<{ key: string; value: unknown }>(`select key, value from owner_settings where key in ('freee_export', 'zengin')`);
  try {
    await page.goto("/settings/money");
    await page.getByLabel("報酬の勘定科目").fill("支払報酬料");
    await page.getByRole("button", { name: "freee の設定を保存" }).click();
    await expect(page.getByText("freee の書き出しの設定を保存しました")).toBeVisible();
    expect((await one<{ value: { rewardAccount: string } }>(`select value from owner_settings where key = 'freee_export'`)).value.rewardAccount).toBe("支払報酬料");

    await page.getByLabel("委託者コード（10桁）").fill("123");
    await page.getByRole("button", { name: "振込データの設定を保存" }).click();
    await expect(page.getByText("委託者コードは10桁の数字です")).toBeVisible();
    await page.getByLabel("委託者コード（10桁）").fill("1234567890");
    await page.getByLabel("委託者名（カナ）").fill("カ）テスト");
    await page.getByLabel("振込元の預金種目").selectOption("ordinary");
    await page.getByRole("button", { name: "振込データの設定を保存" }).click();
    await expect(page.getByText("振込データの設定を保存しました")).toBeVisible();
    const z = (await one<{ value: { requesterCode: string; accountType: string } }>(`select value from owner_settings where key = 'zengin'`)).value;
    expect([z.requesterCode, z.accountType]).toEqual(["1234567890", "ordinary"]);
  } finally {
    await sql(`delete from owner_settings where key in ('freee_export', 'zengin')`);
    for (const r of before) await sql(`insert into owner_settings (key, value) values ($1, $2)`, [r.key, JSON.stringify(r.value)]);
  }
});
