import { expect, test } from "@playwright/test";
import { cleanupEvent, one, sql } from "../helpers/db";
import { expectNoHorizontalScroll } from "../helpers/layout";

/**
 * Phase 11: LINE のトーク履歴から過去の件数の報告を取り込む（オーナーのみ）。
 * - 人・会場・項目は自動で当て、選び直せる。その日に現場がなければ「記録のみ」の現場（お金の計算に入らない）を作る
 * - 名前が並んだ報告で項目に名前がなければ人数で割り、「PI1（A）」はその人の分。見込みの下と応対数は数えない
 * - 現場詳細（【案件詳細】）は会場のメモに入れられる
 */
test.describe.configure({ mode: "serial" });

// 項目名の最後が数字だと件数と見分けにくいので、印は英字だけ
const T = Array.from({ length: 4 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
const VENUE = `E2Eラインモール${T}`;
const A = `ライン一${T}`;
const B = `ライン二${T}`;
const NEW = `新規${T}`;
const PI = `PI${T}`;
let client: { id: string };
let staff: { a: string; b: string };
let date = { iso: "", md: "", line: "" };

test.beforeAll(async () => {
  // 取引先はもとからあるものを使う（新しく作ると、ほかのテストがその取引先で現場を作って消せなくなることがある）
  client = await one(`select id from companies where kind = 'client' order by created_at, id limit 1`);
  await sql(`insert into venues (name) values ($1)`, [VENUE]);
  await sql(`insert into items (name, sort_order) values ($1, 950), ($2, 951)`, [NEW, PI]);
  const a = await one<{ id: string }>(`insert into staff (name, kana) values ($1, 'らいんいち') returning id`, [A]);
  const b = await one<{ id: string }>(`insert into staff (name, kana) values ($1, 'らいんに') returning id`, [B]);
  staff = { a: a.id, b: b.id };
  date = await one(
    `select to_char(d, 'YYYY-MM-DD') as iso, to_char(d, 'FMMM月FMDD日') as md, to_char(d, 'YYYY/MM/DD') || '(' || substr('日月火水木金土', extract(dow from d)::int + 1, 1) || ')' as line from (select public.jst_today() - 3 as d) x`,
  );
});

test.afterAll(async () => {
  const evs = await sql<{ id: string }>(`select id from events where venue_id = (select id from venues where name = $1)`, [VENUE]);
  for (const e of evs) await cleanupEvent(e.id);
  await sql(`delete from staff where id = any($1)`, [[staff.a, staff.b]]);
  await sql(`delete from items where name = any($1)`, [[NEW, PI]]);
  await sql(`delete from venues where name = $1`, [VENUE]);
});

const history = () =>
  [
    "[LINE] E2E件数報告のトーク履歴",
    "保存日時：2026/10/12 22:12",
    "",
    date.line,
    `18:18\tあーちゃん${T}\t"${date.md}`,
    VENUE,
    `${A}、${B}`,
    "",
    "当日",
    `${NEW} 2`,
    `${PI}1（${A}）`,
    "応対数 10",
    "",
    "見込み",
    `${NEW} 5`,
    "鈴木様",
    '13:00〜"',
    `19:00\tあーちゃん${T}\t"【案件詳細】`,
    "● 開催場所",
    VENUE,
    "● 集合場所",
    "9時40分　テスト駅",
    "【持ち物】",
    '○ ペン"',
    "20:00\tだれか\tおつかれさまです",
  ].join("\r\n");

test("トーク履歴を選ぶと人・会場・項目が自動で当たり、取り込むと記録のみの現場に確定した実績が入る", async ({ page, isMobile }) => {
  test.skip(isMobile, "取り込みは PC で確かめる（スマホは横スクロールを確かめる）");
  await page.goto("/import");
  await page.getByRole("link", { name: /LINEのトーク履歴/ }).click();
  await page.getByLabel("トーク履歴のファイル").setInputFiles({ name: "line.txt", mimeType: "text/plain", buffer: Buffer.from(history()) });
  await expect(page.getByText(/件数の報告 1件/)).toBeVisible();
  await expect(page.getByLabel(`「${A}」をどれにするか`)).toHaveValue(staff.a);
  await expect(page.getByLabel(`「${B}」をどれにするか`)).toHaveValue(staff.b);
  await expect(page.getByLabel(`「${NEW}」をどれにするか`)).not.toHaveValue("");
  await expect(page.getByLabel(`「${PI}」をどれにするか`)).not.toHaveValue("");
  // 応対数・見込みの下は項目に出ない
  await expect(page.getByLabel("「応対数」をどれにするか")).toHaveCount(0);
  // 新しい会場なので、記録のみの現場の取引先を選ぶ
  await page.getByText(/「記録のみ」の現場を作るときの取引先/).click();
  await page.getByLabel(`${VENUE}の取引先`).selectOption(client.id);
  const box = page.getByRole("region", { name: "取り込む内容" });
  await expect(box).toContainText("取り込める報告 1件（2人分）");
  await box.getByRole("button", { name: "1件を取り込む" }).click();
  await expect(page.getByRole("region", { name: "取り込みの結果" })).toContainText("2人分の実績を入れました（記録のみの現場を 1件作りました）");

  const ev = await one<{ id: string; counts_only: boolean; report_required: boolean; client_id: string }>(
    `select id, counts_only, report_required, client_id from events where venue_id = (select id from venues where name = $1) and date = $2`,
    [VENUE, date.iso],
  );
  expect(ev).toMatchObject({ counts_only: true, report_required: false, client_id: client.id });
  const rows = await sql<{ staff_id: string; name: string; n: number; source: string; confirmed: boolean }>(
    `select a.staff_id, i.name, ri.confirmed_count as n, r.source, r.confirmed_at is not null as confirmed
       from assignments a join report_items ri on ri.assignment_id = a.id join items i on i.id = ri.item_id join reports r on r.assignment_id = a.id
      where a.event_id = $1 and a.status = 'confirmed' order by a.staff_id = $2 desc, i.name`,
    [ev.id, staff.a],
  );
  expect(rows).toEqual([
    { staff_id: staff.a, name: PI, n: 1, source: "admin", confirmed: true },
    { staff_id: staff.a, name: NEW, n: 1, source: "admin", confirmed: true },
    { staff_id: staff.b, name: NEW, n: 1, source: "admin", confirmed: true },
  ]);

  // 現場詳細を会場のメモに入れる
  const details = page.getByRole("region", { name: "現場詳細" });
  await details.getByRole("button", { name: "会場のメモに入れる" }).click();
  await expect(page.getByText("1か所の会場のメモに入れました")).toBeVisible();
  const v = await one<{ memo: string }>(`select memo from venues where name = $1`, [VENUE]);
  expect(v.memo).toContain("● 集合場所");
  expect(v.memo).not.toContain("鈴木様");
});

test("もう一度取り込んでも、実績のある人には入れない", async ({ page, isMobile }) => {
  test.skip(isMobile, "PC で確かめる");
  await page.goto("/import/line");
  // 画面の準備（ファイルを選んだときの処理）ができてから渡す
  await page.waitForLoadState("networkidle");
  await page.getByLabel("トーク履歴のファイル").setInputFiles({ name: "line.txt", mimeType: "text/plain", buffer: Buffer.from(history()) });
  await page.getByRole("region", { name: "取り込む内容" }).getByRole("button", { name: "1件を取り込む" }).click();
  const result = page.getByRole("region", { name: "取り込みの結果" });
  await expect(result).toContainText("0人分の実績を入れました");
  await expect(result).toContainText("もう実績があります 2件");
});

test("スマホでも横スクロールなく使える。管理者は開けない", async ({ page, browser }) => {
  await page.goto("/import/line");
  // 画面の準備（ファイルを選んだときの処理）ができてから渡す
  await page.waitForLoadState("networkidle");
  await page.getByLabel("トーク履歴のファイル").setInputFiles({ name: "line.txt", mimeType: "text/plain", buffer: Buffer.from(history()) });
  await expect(page.getByText(/件数の報告 1件/)).toBeVisible();
  await expectNoHorizontalScroll(page);
  const ctx = await browser.newContext({ storageState: "e2e/.auth/manager.json" });
  const r = await (await ctx.newPage()).goto("/import/line");
  expect(r?.status()).toBe(404);
  await ctx.close();
});
