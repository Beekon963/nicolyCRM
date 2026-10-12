import { expect, test } from "@playwright/test";
import { cleanupEvent, one, sql } from "../helpers/db";
import { expectNoHorizontalScroll } from "../helpers/layout";

/**
 * Phase 9-1: 取引先の募集の文（LINE）を貼って、現場をまとめて作る。
 * 日付（「11/1・5・6」）・優遇日・会場・時間・役割と人数を読み、取引先を選ぶだけで作れる。会場がなければその名前で作れる
 */
test.describe.configure({ mode: "serial" });

const tag = Math.random().toString(36).slice(2, 6);
const CLIENT = `E2E募集${tag}`;
const VENUE = `E2E募集モール${tag}`;
const NEW_VENUE = `E2E新しい会場${tag}`;
let client: { id: string };
let dates: { md: string; iso: string }[] = [];

test.beforeAll(async () => {
  client = await one(`insert into companies (kind, name, status) values ('client', $1, 'active') returning id`, [CLIENT]);
  await sql(`insert into venues (name) values ($1)`, [VENUE]);
  // 40日後から3日（月をまたいでもよい）
  dates = await sql(
    `select to_char(d, 'FMMM/FMDD') as md, to_char(d, 'YYYY-MM-DD') as iso from generate_series(public.jst_today() + 40, public.jst_today() + 42, interval '1 day') as d`,
  );
});

test.afterAll(async () => {
  const evs = await sql<{ id: string }>(`select id from events where client_id = $1`, [client.id]);
  for (const e of evs) await cleanupEvent(e.id);
  await sql(`delete from companies where id = $1`, [client.id]);
  await sql(`delete from venues where name in ($1, $2)`, [VENUE, NEW_VENUE]);
});

test("募集の文を貼ると、日付・優遇日・会場・時間・人数を読み、取引先を選ぶだけで現場をまとめて作れる", async ({ page, isMobile }) => {
  test.skip(isMobile, "作成は PC で確かめる（スマホは横スクロールを確かめる）");
  await page.goto("/events/from-text");
  const [a, b, c] = dates;
  await page.getByLabel("取引先の募集の文を貼ってください").fill(
    [
      "① docomo｜外販イベント",
      "■稼働場所",
      VENUE,
      "■募集ポジション・人数",
      "クローザー：各日2名",
      "■稼働日・時間",
      "〈募集日〉",
      `${a.md}・${b.md}・${c.md}`,
      "〈優遇日〉",
      `${b.md}に稼働可能な方を優遇いたします。`,
      "稼働時間：11時〜19時(うち1時間休憩)",
    ].join("\n"),
  );
  const read = page.getByRole("region", { name: "読み取った内容" });
  await expect(read).toContainText("3日");
  await expect(read).toContainText("優遇日 1日");
  await expect(read).toContainText(VENUE);
  await expect(read).toContainText("11:00〜19:00");
  await expect(read).toContainText("クローザー 2人");

  await page.getByLabel("取引先", { exact: true }).selectOption(client.id);
  await expect(page.getByRole("textbox", { name: "クローザーの必要人数" })).toHaveValue("2");
  await expect(page.getByLabel("開始", { exact: true })).toHaveValue("11:00");
  await expect(page.getByLabel("集合", { exact: true })).toHaveValue("10:30");
  await expect(page.getByLabel("優遇日").first()).toBeVisible();
  await page.getByRole("button", { name: "3件の現場を作る" }).click();
  await expect(page.getByRole("heading", { name: /^グループ:/ })).toBeVisible();

  const rows = await sql<{ date: string; start_time: string; venue: string; n: number }>(
    `select to_char(e.date, 'YYYY-MM-DD') as date, to_char(e.start_time, 'HH24:MI') as start_time, v.name as venue,
            (select sum(required_count)::int from event_requirements r where r.event_id = e.id) as n
       from events e join venues v on v.id = e.venue_id where e.client_id = $1 order by e.date`,
    [client.id],
  );
  expect(rows).toEqual(dates.map((d) => ({ date: d.iso, start_time: "11:00", venue: VENUE, n: 2 })));
});

test("会場が CRM になければ、その名前で作ってから現場を作れる", async ({ page, isMobile }) => {
  test.skip(isMobile, "PC で確かめる");
  await page.goto("/events/from-text");
  await page.getByLabel("取引先の募集の文を貼ってください").fill([`▼${NEW_VENUE}`, `日程：${dates[0].md}(土)`, "募集：クローザー1名", "※クローザー2名体制", "時間：10:30-18:30"].join("\n"));
  const read = page.getByRole("region", { name: "読み取った内容" });
  await expect(read).toContainText(`「${NEW_VENUE}」は会場にありません`);
  await read.getByRole("button", { name: "この名前で会場を作る" }).click();
  await expect(read).not.toContainText("は会場にありません");
  await expect(page.getByLabel("会場", { exact: true }).locator("option:checked")).toHaveText(NEW_VENUE);
  await expect(page.getByRole("textbox", { name: "クローザーの必要人数" })).toHaveValue("1");
  await expect(page.getByLabel("開始", { exact: true })).toHaveValue("10:30");
});

test("スマホでも横スクロールなく使える", async ({ page }) => {
  await page.goto("/events/from-text");
  await page.getByLabel("取引先の募集の文を貼ってください").fill(`■稼働場所\n${VENUE}\n〈募集日〉${dates[0].md}・${dates[1].md}\n稼働時間：11時〜19時\nクローザー：各日1名`);
  await expect(page.getByRole("region", { name: "読み取った内容" })).toContainText("2日");
  await expectNoHorizontalScroll(page);
});
