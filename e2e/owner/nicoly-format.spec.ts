import { expect, test } from "@playwright/test";
import { cleanupEvent, one, sql } from "../helpers/db";
import { expectNoHorizontalScroll } from "../helpers/layout";

/**
 * Phase 9: NICOLY フォーマット。
 * - 「新規1(山田)」（件数のあとに獲得した人）・「当日」「後日」・項目の下のメモを読み、NICOLY の形で書き出す
 * - マイページ: LINE に書いた報告を貼ると、本人の分の件数が報告に入る（メモはコメントに）
 * - 実績確認 → LINEの報告を変換: そのまま、その日の現場の人の速報として入れられる（本人がもう報告した人には入れない）
 */
test.describe.configure({ mode: "serial" });

// 項目名の最後が数字だと「〇〇2」の件数と見分けにくいので、印は英字だけ
const T = Array.from({ length: 4 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
const CLIENT = `E2E楽天${T}`;
const VENUE = `E2E楽天モール${T}`;
const FORMAT = `E2E NICOLY${T}`;
const ITEMS = [`新規${T}`, `RMMNP${T}`, `RMMNP${T}（後日）`, `カード${T}`];
const NICOLY_EVENT_BLOCK = "【NICOLY フォーマット】\n\n{日付} {会場}\n{稼働者}\n\n【実績】\n{当日・後日の実績}\n\n{所感}\n";

let client: { id: string };
let eventId = "";
let md = "";
let staff: { id: string; name: string; token: string }[] = [];
const asg: string[] = [];

const reportText = () =>
  [
    "【NICOLY フォーマット】",
    "",
    `${md} ${VENUE}`,
    `${staff[0].name}、${staff[1].name}`,
    "",
    "【実績】",
    "当日",
    `新規${T}1(${staff[0].name})`,
    "",
    `RMMNP${T}2(${staff[0].name})`,
    "ソフトバンクから楽天",
    "iPhone17×2",
    "",
    `カード${T}1(${staff[1].name})`,
    "",
    "後日",
    `RMMNP${T}1(${staff[0].name})`,
  ].join("\n");

test.beforeAll(async () => {
  client = await one(`insert into companies (kind, name, status) values ('client', $1, 'active') returning id`, [CLIENT]);
  const venue = await one<{ id: string }>(`insert into venues (name) values ($1) returning id`, [VENUE]);
  const items = await sql<{ id: string }>(`insert into items (name, sort_order) select n, 900 + i from unnest($1::text[]) with ordinality as x(n, i) returning id`, [ITEMS]);
  for (const i of items) await sql(`insert into company_items (company_id, item_id) values ($1, $2)`, [client.id, i.id]);
  await sql(`insert into report_formats (name, company_id, for_staff, event_block) values ($1, $2, true, $3)`, [FORMAT, client.id, NICOLY_EVENT_BLOCK]);
  // 2日前の現場（報告できる期間のうち）に2人
  const ev = await one<{ id: string; md: string }>(
    `insert into events (client_id, venue_id, date, start_time, end_time) values ($1, $2, public.jst_today() - 2, '10:00', '19:00') returning id, to_char(date, 'FMMM/FMDD') as md`,
    [client.id, venue.id],
  );
  eventId = ev.id;
  md = ev.md;
  const role = await one<{ id: string }>(`select id from roles where name = 'クローザー'`);
  staff = await sql(`select id, name, mypage_token as token from staff where status = 'active' order by random() limit 2`);
  for (const s of staff) {
    asg.push((await one<{ id: string }>(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed') returning id`, [eventId, s.id, role.id])).id);
  }
});

test.afterAll(async () => {
  await cleanupEvent(eventId);
  await sql(`delete from report_formats where name = $1`, [FORMAT]);
  await sql(`delete from company_items where company_id = $1`, [client.id]);
  await sql(`delete from items where name = any($1)`, [ITEMS]);
  await sql(`delete from venues where name = $1`, [VENUE]);
  await sql(`delete from companies where id = $1`, [client.id]);
});

const counts = async (assignmentId: string) =>
  Object.fromEntries(
    (await sql<{ name: string; n: number }>(`select i.name, ri.reported_count as n from report_items ri join items i on i.id = ri.item_id where ri.assignment_id = $1 and ri.reported_count > 0`, [assignmentId])).map(
      (r) => [r.name, r.n],
    ),
  );

test("マイページ: NICOLY フォーマットの報告を貼ると、本人の分の件数（後日は（後日）の項目）が入り、メモはコメントに入る", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`/m/${staff[0].token}/report/${asg[0]}`);
  await page.getByText("LINE に書いた報告から入れる").click();
  await page.getByLabel("LINE に書いた報告を貼ってください").fill(reportText());
  // 書き出し（NICOLY の形）: 当日・後日に分けて1人ずつ
  const out = page.getByRole("region", { name: "変換した報告" });
  await expect(out).toContainText(`当日\n新規${T}1(${staff[0].name})`);
  await expect(out).toContainText(`RMMNP${T}2(${staff[0].name})\nソフトバンクから楽天\niPhone17×2`);
  await expect(out).toContainText(`カード${T}1(${staff[1].name})`);
  await expect(out).toContainText(`後日\nRMMNP${T}1(${staff[0].name})`);

  await expect(page.getByText(`新規${T} 1・RMMNP${T} 2・RMMNP${T}（後日） 1`)).toBeVisible();
  await page.getByRole("button", { name: "この件数を報告に入れる" }).click();
  await expect(page.getByRole("textbox", { name: `RMMNP${T}`, exact: true })).toHaveValue("2");
  await expect(page.getByRole("textbox", { name: `RMMNP${T}（後日）` })).toHaveValue("1");
  await expect(page.getByRole("textbox", { name: `カード${T}` })).toHaveValue("0");
  await expect(page.getByLabel("一言コメント（任意）")).toHaveValue(`RMMNP${T}: ソフトバンクから楽天 / iPhone17×2`);
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "送信する" }).click();
  await expect(page).toHaveURL(new RegExp(`/m/${staff[0].token}/report$`));
  expect(await counts(asg[0])).toEqual({ [`新規${T}`]: 1, [`RMMNP${T}`]: 2, [`RMMNP${T}（後日）`]: 1 });
  await ctx.close();
});

test("実績確認 → LINEの報告を変換: 現場と人を選んで速報で入れられる。本人がもう報告した人には入れない", async ({ page, isMobile }) => {
  test.skip(isMobile, "PC で確かめる（スマホの表示は no-scroll で確認）");
  await page.goto(`/results/convert?client=${client.id}`);
  await page.getByLabel("LINE に書いた報告を貼ってください").fill(reportText());
  const enter = page.getByRole("region", { name: "実績に入れる" });
  await expect(enter.getByLabel("現場")).toHaveValue(eventId);
  await expect(enter.getByLabel(`「${staff[0].name}」をだれの報告にするか`)).toHaveValue(asg[0]);
  await expect(enter.getByLabel(`「${staff[1].name}」をだれの報告にするか`)).toHaveValue(asg[1]);
  await enter.getByRole("button", { name: "2人分を速報で入れる" }).click();
  await expect(page.getByText(new RegExp(`1人分の報告を入れました（入れなかった人: ${staff[0].name}: 本人がもう報告しています`))).toBeVisible();
  expect(await counts(asg[1])).toEqual({ [`カード${T}`]: 1 });
  expect(await one(`select source from reports where assignment_id = $1`, [asg[1]])).toEqual({ source: "admin" });
  // 本人が送った分はそのまま
  expect(await counts(asg[0])).toEqual({ [`新規${T}`]: 1, [`RMMNP${T}`]: 2, [`RMMNP${T}（後日）`]: 1 });
});
