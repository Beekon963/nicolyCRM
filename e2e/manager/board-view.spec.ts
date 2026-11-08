import { expect, test } from "@playwright/test";
import { cleanupEvent, dropStaff, freeFutureDate, makeStaff, one, sql } from "../helpers/db";
import { expectNoHorizontalScroll } from "../helpers/layout";

/**
 * Phase 10: 稼働表を分かりやすく。
 * - 現場のマスは人数分のマス（確定は塗り・打診中は縞・空きは白）。欠員の現場に「○N」（その日○で空いている人）
 * - 1つのマスに出す現場は1件。あふれた分は「＋N件」（隠れた欠員は赤で）
 * - 絞り込み: 欠員の現場だけ・○で空いている人だけ（端末に覚える）
 * - 日ビュー（Phase 22-3。スマホは最初からこれ）: 上に「現場未定 N人」の帯、現場のカードは欠員が先。「空き」から候補を選んで打診の画面へ
 */
test.describe.configure({ mode: "serial" });

const tag = Math.random().toString(36).slice(2, 6);
const CLIENT = `E2E見やすく${tag}`;
let date = "";
let day = 0;
let client: { id: string };
let events: { short: string; full: string } = { short: "", full: "" };
let venues: { short: string; full: string } = { short: "", full: "" };
let free: { id: string; name: string };
let busy: { id: string; name: string };
let people: { id: string; name: string }[] = [];

test.beforeAll(async () => {
  date = await freeFutureDate();
  day = Number(date.slice(8));
  client = await one(`insert into companies (kind, name, status) values ('client', $1, 'active') returning id`, [CLIENT]);
  const role = await one<{ id: string }>(`select id from roles where name = 'クローザー'`);
  const vs = await sql<{ id: string; name: string }>(`select id, name from venues where is_active order by random() limit 2`);
  venues = { short: vs[0].name, full: vs[1].name };
  const mk = async (venueId: string, required: number) => {
    const e = await one<{ id: string }>(`insert into events (client_id, venue_id, date, start_time, end_time) values ($1, $2, $3, '10:00', '19:00') returning id`, [client.id, venueId, date]);
    await sql(`insert into event_requirements (event_id, role_id, required_count) values ($1, $2, $3)`, [e.id, role.id, required]);
    return e.id;
  };
  events = { short: await mk(vs[0].id, 2), full: await mk(vs[1].id, 1) };
  // このテストだけの人を3人（ほかのテストと取り合わないように）: 1人目は「欠員の現場」に確定、2人目は「そろう現場」に確定、3人目は○で空いている
  people = [await makeStaff("見やすく 一郎"), await makeStaff("見やすく 二郎"), await makeStaff("見やすく 三郎")];
  await sql(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed'), ($4, $5, $3, 'confirmed')`, [events.short, people[0].id, role.id, events.full, people[1].id]);
  busy = people[1];
  free = people[2];
  await sql(`insert into availability (staff_id, date, status, source) values ($1, $2, 'ok', 'admin')`, [free.id, date]);
});

test.afterAll(async () => {
  for (const id of [events.short, events.full]) await cleanupEvent(id);
  await dropStaff(...people.map((p) => p.id));
  await sql(`delete from companies where id = $1`, [client.id]);
});

// 見せ方のタブ（Phase 22: 日・週・月・表）を端末に覚えた状態で開く
const board = (page: import("@playwright/test").Page, view: "table" | "day") => page.addInitScript((v) => window.localStorage.setItem("nicoly.board.tab", JSON.stringify(v)), view);

test("表: 現場は人数分のマスで、欠員の現場が先。もう1件は「＋1件」。○で空いている人の数が出る", async ({ page, isMobile }) => {
  test.skip(isMobile, "表は PC で確かめる");
  await board(page, "table");
  await page.goto(`/events/board?month=${date.slice(0, 7)}`);
  const cell = page.getByRole("button", { name: `${CLIENT} ${day}日`, exact: true });
  const chip = cell.locator('[data-tile="shortage"]');
  await expect(chip).toContainText(venues.short);
  await expect(chip.getByRole("img", { name: "2人中1人確定" })).toBeVisible();
  await expect(chip).toContainText("欠1");
  await expect(chip).toContainText(/○\d+/);
  await expect(cell).toContainText("＋1件");
  await expect(cell).not.toContainText(venues.full);
});

test("表: 「欠員の現場だけ」でそろった現場が消え、「○で空いている人だけ」で予定のある人が消える。端末に覚える", async ({ page, isMobile }) => {
  test.skip(isMobile, "表は PC で確かめる");
  await board(page, "table");
  await page.goto(`/events/board?month=${date.slice(0, 7)}`);
  await expect(page.getByRole("link", { name: busy.name, exact: true })).toBeAttached();
  await page.getByRole("button", { name: /^欠員の現場だけ/ }).click();
  const cell = page.getByRole("button", { name: `${CLIENT} ${day}日`, exact: true });
  await expect(cell).toContainText(venues.short);
  await expect(cell).not.toContainText("＋1件");
  await page.getByRole("button", { name: /^○で空いている人だけ/ }).click();
  await expect(page.getByRole("link", { name: free.name, exact: true })).toBeAttached();
  await expect(page.getByRole("link", { name: busy.name, exact: true })).toHaveCount(0);
  // 開き直しても絞り込みは残る
  await page.reload();
  await expect(page.getByRole("button", { name: /^欠員の現場だけ/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("link", { name: busy.name, exact: true })).toHaveCount(0);
  // 元に戻す
  await page.getByRole("button", { name: /^欠員の現場だけ/ }).click();
  await page.getByRole("button", { name: /^○で空いている人だけ/ }).click();
  await expect(page.getByRole("link", { name: busy.name, exact: true })).toBeAttached();
});

test("日: 現場未定の人が上の帯に出る。現場のカードは欠員が先で、「空き」から候補を選ぶと打診・確定の画面が開く。横にずれない", async ({ page, isMobile }) => {
  if (!isMobile) await board(page, "day");
  await page.goto(`/events/board?month=${date.slice(0, 7)}&date=${date}`);
  const view = page.getByTestId("board-day");
  await expect(view.getByRole("heading", { name: new RegExp(`^${Number(date.slice(5, 7))}/${day}\\(`) })).toBeVisible();
  // 帯: ○で現場が決まっていない人（多いときは「ほか N人を見る」の中）
  const band = view.getByTestId("unassigned-band");
  const more = band.getByRole("button", { name: /^ほか \d+人を見る$/ });
  if (await more.count()) await more.click();
  await expect(band.getByRole("button", { name: free.name })).toBeVisible();
  // 現場のカード: 欠員の現場が先。配置／必要と、入っている人の名前
  const cards = view.locator("[data-card]");
  await expect(cards.first()).toHaveAttribute("data-card", "shortage");
  await expect(cards.first()).toContainText(venues.short);
  await expect(cards.first()).toContainText("1/2人");
  await expect(cards.first().locator('[data-name-chip="confirmed"]')).toHaveText(people[0].name);
  await expect(cards.nth(1)).toHaveAttribute("data-card", "filled");
  await expect(cards.nth(1)).toContainText(venues.full);
  // 「空き」→ 候補（その日○△の人）→ 名前 で、その人の打診・確定の画面。入れたい現場が先頭に枠つきで出る
  await cards.first().getByRole("button", { name: /空きに人を入れる$/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: free.name }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: new RegExp(`^${free.name}`) })).toBeVisible();
  await expect(sheet.locator("[data-focused]")).toContainText(venues.short);
  await page.keyboard.press("Escape");
  await expectNoHorizontalScroll(page);
  // 「現場未定だけ」にすると、そろった現場のカードは出ない
  await page.getByRole("button", { name: /^現場未定だけ/ }).click();
  await expect(view.locator("[data-card]")).toHaveCount(1);
  await page.getByRole("button", { name: /^現場未定だけ/ }).click();
});

