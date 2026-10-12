import { expect, test } from "@playwright/test";
import { cleanupEvent, freeFutureDate, one, sql } from "../helpers/db";
import { expectNoHorizontalScroll } from "../helpers/layout";

/**
 * Phase 10: 稼働表を分かりやすく。
 * - 現場のマスは人数分のマス（確定は塗り・打診中は縞・空きは白）。欠員の現場に「○N」（その日○で空いている人）
 * - 1つのマスに出す現場は1件。あふれた分は「＋N件」（隠れた欠員は赤で）
 * - 絞り込み: 欠員の現場だけ・○で空いている人だけ（端末に覚える）
 * - スマホは日ごとのリスト（欠員の現場が上）。○で空いている人から打診の画面へ
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
  // その日に予定のない人を3人: 1人目は「欠員の現場」に確定、2人目は「そろう現場」に確定、3人目は○で空いている
  const people = await sql<{ id: string; name: string }>(
    `select s.id, s.name from staff s where s.status = 'active'
       and not exists (select 1 from assignments a join events e on e.id = a.event_id where a.staff_id = s.id and e.date = $1)
       and (select count(*) from staff x where x.name = s.name) = 1
     order by random() limit 3`,
    [date],
  );
  await sql(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed'), ($4, $5, $3, 'confirmed')`, [events.short, people[0].id, role.id, events.full, people[1].id]);
  busy = people[1];
  free = people[2];
  await sql(`delete from availability where staff_id = any($1) and date = $2`, [people.map((p) => p.id), date]);
  await sql(`insert into availability (staff_id, date, status, source) values ($1, $2, 'ok', 'admin')`, [free.id, date]);
});

test.afterAll(async () => {
  for (const id of [events.short, events.full]) await cleanupEvent(id);
  await sql(`delete from availability where staff_id = $1 and date = $2`, [free.id, date]);
  await sql(`delete from companies where id = $1`, [client.id]);
});

const board = (page: import("@playwright/test").Page, view: "table" | "list") =>
  page.addInitScript((v) => window.localStorage.setItem("nicoly.board.view", JSON.stringify(v)), view);

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

test("リスト: 日ごとに欠員の現場が上。○で空いている人を押すと、打診・確定の画面が開く。横にずれない", async ({ page, isMobile }) => {
  if (!isMobile) await board(page, "list");
  await page.goto(`/events/board?month=${date.slice(0, 7)}`);
  const list = page.getByTestId("board-day-list");
  const section = list.getByRole("region", { name: new RegExp(`^${Number(date.slice(5, 7))}/${day}\\(`) });
  const rows = section.locator("[data-tile]");
  await expect(rows.first()).toContainText(venues.short);
  await expect(rows.first()).toHaveAttribute("data-tile", "shortage");
  await expect(rows.nth(1)).toContainText(venues.full);
  await expect(rows.first().getByRole("img", { name: "2人中1人確定" })).toBeVisible();
  await section.getByText(/この日○で空いている人/).click();
  await section.getByRole("button", { name: free.name }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: new RegExp(`^${free.name}`) })).toBeVisible();
  await page.keyboard.press("Escape");
  await expectNoHorizontalScroll(page);
  // 「欠員だけ」にすると、そろった現場は出ない
  await page.getByRole("button", { name: /^欠員の現場だけ/ }).click();
  await expect(section.locator("[data-tile]")).toHaveCount(1);
  await page.getByRole("button", { name: /^欠員の現場だけ/ }).click();
});
