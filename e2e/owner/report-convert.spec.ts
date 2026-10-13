import { expect, test } from "@playwright/test";
import { cleanupEvent, dropStaff, freeFutureDate, makeStaff, one, sql } from "../helpers/db";
import { expectNoHorizontalScroll } from "../helpers/layout";

/**
 * Phase 8: NextWave の報告フォーマットと自動変換。
 * - 書式の見本（NextWave）から作れる。【実績】は獲得した項目だけ1行ずつ、2人以上の現場は全員分をまとめる
 * - 獲得項目を一覧の貼り付けでまとめて登録（光・カードには（仮）も）
 * - LINE にいつもの書き方で書いた報告を、取引先の公認名称・書式に直す（オーナーは言いかえを覚えさせられる）
 * - マイページ: 同じ現場の全員分をまとめた報告をコピーでき、LINE の文の変換もできる
 */
test.describe.configure({ mode: "serial" });

const tag = Math.random().toString(36).slice(2, 6);
const CLIENT = `E2E変換${tag}`;
const HIKARI = `ドコモ光 1G ${tag}`;
const GOLD = `ｄカードGOLD ${tag}`;
const FORMAT = `E2E見本${tag}`;
const FORMAT_UI = `E2E見本画面${tag}`;
const BULK = [`E2E一括光${tag}`, `E2E一括${tag}`];
const NEXTWAVE_EVENT_BLOCK =
  "【ネクストウェーブ報告フォーマット】\n\n日付：{日付}\n{会場}\n稼働者：{稼働者}\n\n【実績】\n{獲得した項目}\n\n【所感】\n{所感}\n";

let client: { id: string };
let eventId = "";
let staff: { id: string; name: string; token: string }[] = [];
let assignmentId = "";

test.beforeAll(async () => {
  client = await one(`insert into companies (kind, name, status) values ('client', $1, 'active') returning id`, [CLIENT]);
  // この取引先で使う項目: 機種変更（もとからある）と、公認名称ふうの項目・（仮）の項目
  const kihen = await one<{ id: string }>(`select id from items where name = '機種変更'`);
  const created = await sql<{ id: string }>(
    `insert into items (name, sort_order) values ($1, 900), ($2, 901), ($3, 902) returning id`,
    [HIKARI, `${HIKARI}（仮）`, GOLD],
  );
  for (const i of [kihen, ...created]) await sql(`insert into company_items (company_id, item_id) values ($1, $2)`, [client.id, i.id]);
  await sql(`insert into report_formats (name, company_id, for_staff, event_block) values ($1, $2, true, $3)`, [FORMAT, client.id, NEXTWAVE_EVENT_BLOCK]);

  // 2人の現場。1人目は報告ずみ（機種変更 2・コメント）、2人目はまだ
  const date = await freeFutureDate();
  const role = await one<{ id: string }>(`select id from roles where name = 'クローザー'`);
  eventId = (
    await one<{ id: string }>(
      `insert into events (client_id, venue_id, date, start_time, end_time) values ($1, (select id from venues where address <> '' limit 1), $2, '10:00', '19:00') returning id`,
      [client.id, date],
    )
  ).id;
  // 2人はこのテストで作る（ほかのテストと同じ人を取り合わないように）
  staff = [await makeStaff("変換 一郎"), await makeStaff("変換 二郎")];
  assignmentId = (await one<{ id: string }>(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed') returning id`, [eventId, staff[0].id, role.id])).id;
  await sql(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed')`, [eventId, staff[1].id, role.id]);
  await sql(`insert into reports (assignment_id, submitted_at, comment) values ($1, now(), '店舗様から評価いただきました')`, [assignmentId]);
  await sql(`insert into report_items (assignment_id, item_id, reported_count) values ($1, $2, 2)`, [assignmentId, kihen.id]);
});

test.afterAll(async () => {
  await cleanupEvent(eventId);
  await dropStaff(...staff.map((s) => s.id));
  await sql(`delete from report_formats where name in ($1, $2)`, [FORMAT, FORMAT_UI]);
  await sql(`delete from item_aliases where company_id = $1`, [client.id]);
  await sql(`delete from company_items where company_id = $1`, [client.id]);
  await sql(`delete from items where name = any($1)`, [[HIKARI, `${HIKARI}（仮）`, GOLD, ...BULK, `${BULK[0]}（仮）`]]);
  await sql(`delete from companies where id = $1`, [client.id]);
});

test("オーナー: 書式の見本（NextWave）から作れる", async ({ page, isMobile }) => {
  test.skip(isMobile, "書式の作成は PC で確かめる");
  await page.goto("/settings/report-formats");
  await page.getByRole("button", { name: "見本から作る: NextWave（ネクストウェーブ）" }).click();
  const card = page.locator("details[open]").last();
  await card.getByLabel("名前", { exact: true }).fill(FORMAT_UI);
  await card.getByLabel("使う取引先").selectOption(client.id);
  const preview = card.locator("pre").first();
  await expect(preview).toContainText("【ネクストウェーブ報告フォーマット】");
  await expect(preview).toContainText("稼働者：山田、佐藤");
  // 見本には「稼働開始の報告」も入る
  await expect(card.getByLabel("稼働開始の報告（任意）")).toHaveValue("{会場}\n稼働者：{稼働者}\n稼働します");
  await card.getByRole("button", { name: "このフォーマットを作る" }).click();
  await expect(page.getByText("フォーマットを作りました")).toBeVisible();
  const saved = await one<{ event_block: string; start_block: string }>(`select event_block, start_block from report_formats where name = $1`, [FORMAT_UI]);
  expect(saved.event_block).toContain("{獲得した項目}");
  expect(saved.start_block).toContain("稼働します");
});

test("オーナー: 獲得項目を一覧の貼り付けでまとめて登録でき、光・カードには（仮）も作れる", async ({ page, isMobile }) => {
  test.skip(isMobile, "まとめて登録は PC で確かめる");
  await page.goto("/settings/masters/items");
  await page.getByText("まとめて登録する（一覧を貼る）").click();
  await page.getByLabel("項目の名前（1行に1つ）").fill(`【公認名称】\n${BULK[0]}\n${BULK[1]}\n機種変更`);
  await page.getByLabel("この取引先の現場で使う項目にする（任意）").selectOption(client.id);
  // 光の行だけ（仮）が足されて 4 項目
  await page.getByRole("button", { name: "4項目を登録する" }).click();
  await expect(page.getByText(/3項目を作りました（1項目はもうありました）/)).toBeVisible();
  const rows = await sql<{ name: string }>(`select i.name from company_items ci join items i on i.id = ci.item_id where ci.company_id = $1 and i.name like 'E2E一括%'`, [client.id]);
  expect(rows.map((r) => r.name).sort()).toEqual([BULK[0], `${BULK[0]}（仮）`, BULK[1]].sort());
});

test("LINE の報告を変換: いつもの書き方を公認名称に直し、わからない書き方は選んで覚えさせられる", async ({ page }) => {
  await page.goto(`/results/convert?client=${client.id}`);
  await page.getByLabel("LINE に書いた報告を貼ってください").fill(["10/11", "DSテスト", "山田", "キヘン 2", "光 1", "光（仮） 1", "GOLD 1", "ほげ 1", "【所感】", "好調でした"].join("\n"));
  const list = page.getByRole("region", { name: "項目名のそろえ方" });
  await expect(list.getByRole("combobox", { name: "「キヘン」をどの項目にするか" })).toHaveValue("機種変更");
  await expect(list.getByRole("combobox", { name: "「光」をどの項目にするか" })).toHaveValue(HIKARI);
  await expect(list.getByRole("combobox", { name: "「光（仮）」をどの項目にするか" })).toHaveValue(`${HIKARI}（仮）`);
  await expect(list.getByRole("combobox", { name: "「GOLD」をどの項目にするか" })).toHaveValue(GOLD);
  await expect(list.getByText("選んでください 1件")).toBeVisible();

  // わからない書き方を選び、覚えさせる
  await list.getByRole("combobox", { name: "「ほげ」をどの項目にするか" }).selectOption("機種変更");
  await list.getByRole("listitem").filter({ hasText: "ほげ" }).getByRole("button", { name: "覚える" }).click();
  await expect(page.getByText("「ほげ」は「機種変更」と覚えました")).toBeVisible();
  expect((await one<{ n: number }>(`select count(*)::int as n from item_aliases where company_id = $1 and alias = 'ほげ'`, [client.id])).n).toBe(1);

  const out = page.getByRole("region", { name: "変換した報告" });
  await expect(out).toContainText("【ネクストウェーブ報告フォーマット】");
  await expect(out).toContainText("稼働者：山田");
  await expect(out).toContainText("機種変更 3");
  await expect(out).toContainText(`${HIKARI} 1`);
  await expect(out).toContainText(`${HIKARI}（仮） 1`);
  await expect(out).toContainText("好調でした");
  await expectNoHorizontalScroll(page);
});

test("管理者: 変換は使えるが、言いかえを覚えさせるボタンは出ない", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "e2e/.auth/manager.json" });
  const page = await ctx.newPage();
  await page.goto(`/results/convert?client=${client.id}`);
  await page.getByLabel("LINE に書いた報告を貼ってください").fill("キヘン 1\nふが 1");
  await expect(page.getByRole("combobox", { name: "「ふが」をどの項目にするか" })).toBeVisible();
  await expect(page.getByRole("button", { name: "覚える" })).toHaveCount(0);
  await ctx.close();
});

test("マイページ: 2人の現場は全員分をまとめた報告が出て、まだの人を知らせる。LINE の文の変換もできる", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`/m/${staff[0].token}/report/${assignmentId}`);
  const copy = page.locator("section", { has: page.getByRole("heading", { name: "LINE用にコピー（日報）" }) });
  // 並びは役割 → ふりがなの順
  const [a, b] = staff.map((x) => x.name);
  await expect(copy).toContainText(new RegExp(`稼働者：(${a}、${b}|${b}、${a})`));
  await expect(copy).toContainText("機種変更 2");
  await expect(copy).toContainText("代表の1人が送ってください");
  await expect(copy).toContainText(`まだ報告していない人: ${staff[1].name}`);

  await page.getByText("LINE に書いた報告から変換").click();
  await page.getByLabel("LINE に書いた報告を貼ってください").fill("キヘン 1\nGOLD 2");
  const out = page.getByRole("region", { name: "変換した報告" });
  await expect(out).toContainText("機種変更 1");
  await expect(out).toContainText(`${GOLD} 2`);
  await expectNoHorizontalScroll(page);
  await ctx.close();
});
