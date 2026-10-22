import { expect, test } from "@playwright/test";
import { dropClient, dropStaff, makeClient, makeStaff, one, sql } from "../helpers/db";

/**
 * 管理用スプレッドシートを自動で読む（Phase 18）。Google は読まず、偽のスプレッドシート（e2e/mock-sheets.mjs）を読む。
 * 設定は1つだけなので、PC のプロジェクトで順番に確かめる。
 */
test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => isMobile, "設定は1つだけなので、PC のプロジェクトで確かめる");

const MOCK = "http://127.0.0.1:4012";
const SHEET_URL = "https://docs.google.com/spreadsheets/d/E2E_SYNC_SHEET_0123456789/edit#gid=0";
const tag = Math.random().toString(36).slice(2, 7);

let client: { id: string; name: string };
let staff: { id: string; name: string };
let venueId = "";
const venueName = `E2E同期会場${tag}`;
const unknownStaff = `名簿にない人${tag}`;
/** 来月（いつでも今日より後）の月とタブ名 */
let month = "";
let tab = "";
let lastDay = 0;

function csvRows(): string[][] {
  const m = Number(month.slice(5));
  const cols = Array.from({ length: lastDay }, (_, i) => `${m}/${i + 1}`);
  const row = (head: string[], cells: Record<number, string> = {}) => {
    const r = Array<string>(4 + lastDay).fill("");
    head.forEach((v, i) => (r[i] = v));
    for (const [d, v] of Object.entries(cells)) r[3 + Number(d)] = v;
    return r;
  };
  return [
    ["", "", "", "日付", ...cols, "出勤日数"],
    ["ランク", "名前", "最寄り駅", "曜日", ...cols.map(() => "月")],
    row([client.name, "", "", "単価"], { [lastDay]: "¥20,000" }),
    row(["", "", "", "現場"], { [lastDay]: venueName }),
    row(["", "", "", "人数"], { [lastDay]: "2" }),
    row(["A", staff.name, "大宮", "単価"]),
    row(["", "", "", "場所"], { [lastDay]: venueName }),
    row(["", "", "", "シフト"], { [lastDay - 1]: "⭕️" }),
    row(["B", unknownStaff, "", "単価"]),
    row(["", "", "", "場所"], { [lastDay]: venueName }),
    row(["", "", "", "シフト"]),
  ];
}
const toCsv = (rows: string[][]) => rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");

async function setTab(request: Parameters<Parameters<typeof test>[2]>[0]["request"]) {
  const r = await request.post(`${MOCK}/__set`, { data: { reset: true, tab, csv: toCsv(csvRows()) } });
  expect(r.ok()).toBeTruthy();
}

test.beforeAll(async () => {
  const d = await one<{ month: string; last_day: number }>(
    `select to_char(date_trunc('month', public.jst_today()) + interval '1 month', 'YYYY-MM') as month,
            extract(day from (date_trunc('month', public.jst_today()) + interval '2 month - 1 day'))::int as last_day`,
  );
  month = d.month;
  lastDay = d.last_day;
  tab = month.replace("-", "");
  client = await makeClient("E2E同期取引先");
  staff = await makeStaff("同期 太郎");
  venueId = (await one<{ id: string }>(`insert into venues (name) values ($1) returning id`, [venueName])).id;
  await sql(`delete from settings where key = 'sheet_sync'`);
  await sql(`delete from sheet_syncs where ran_at > now() - interval '1 hour'`);
});

test.afterAll(async () => {
  const events = await sql<{ id: string }>(`select id from events where venue_id = $1`, [venueId]);
  for (const e of events) {
    await sql(`delete from event_rates where event_id = $1`, [e.id]);
    await sql(`delete from event_requirements where event_id = $1`, [e.id]);
    await sql(`delete from assignment_private where assignment_id in (select id from assignments where event_id = $1)`, [e.id]);
    await sql(`delete from assignments where event_id = $1`, [e.id]);
    await sql(`delete from events where id = $1`, [e.id]);
  }
  await sql(`delete from sheet_sync_items where month = $1`, [`${month}-01`]);
  await sql(`delete from sheet_name_aliases where sheet_name = any($1)`, [[unknownStaff, venueName, client.name]]);
  await sql(`delete from settings where key = 'sheet_sync'`);
  await sql(`delete from sheet_syncs where ran_at > now() - interval '1 hour'`);
  await dropStaff(staff.id);
  await dropClient(client.id);
  await sql(`delete from venues where id = $1`, [venueId]);
});

test("オーナーが読む元を決めて「今すぐ読む」と、現場・人・○△× が入り、合わない名前が出る。対応づけると次から入る", async ({ page, request }) => {
  test.setTimeout(90_000);
  await setTab(request);
  await page.goto("/import");
  const panel = page.getByTestId("sheet-sync");
  await expect(panel.getByRole("status")).toContainText("まだ読んでいません");
  await panel.getByLabel("読む元の URL（管理用スプレッドシート）").fill(SHEET_URL);
  await panel.getByRole("button", { name: "保存する" }).click();
  await expect(page.getByText("自動で読むのを止めました")).toBeVisible();

  await panel.getByRole("button", { name: "今すぐ読む" }).click();
  await expect(panel.getByRole("status")).toContainText(`${tab}: 現場 +1・人 +1・○△× 1`, { timeout: 20_000 });
  await expect(panel.getByRole("status")).toContainText("合わない名前 1件");
  const unmatched = page.getByTestId("sheet-sync-unmatched");
  await expect(unmatched).toContainText(unknownStaff);

  // DB に入っている（確定・必要人数・○・単価）
  const ev = await one<{ id: string; required: number; confirmed: number; ok: number; rate: number }>(
    `select e.id,
            (select required_count from event_requirements r where r.event_id = e.id) as required,
            (select count(*)::int from assignments a where a.event_id = e.id and a.status = 'confirmed') as confirmed,
            (select count(*)::int from availability v where v.staff_id = $2 and v.status = 'ok') as ok,
            (select amount from event_rates x where x.event_id = e.id) as rate
       from events e where e.venue_id = $1 and e.client_id = $3`,
    [venueId, staff.id, client.id],
  );
  expect(ev.required).toBe(2);
  expect(ev.confirmed).toBe(1);
  expect(ev.ok).toBe(1);
  expect(ev.rate).toBe(20000);

  // 合わない名前 → 取り込まない にする → 次に読むと出なくなる
  await unmatched.getByLabel(`${unknownStaff} の対応づけ`).selectOption("skip");
  await unmatched.getByRole("button", { name: "決める" }).click();
  await expect(unmatched.getByText("取り込まないようにしました")).toBeVisible();
  await panel.getByRole("button", { name: "今すぐ読む" }).click();
  await expect(panel.getByRole("status")).toContainText(`${tab}: 現場 +0・人 +0・○△× 0`, { timeout: 20_000 });
  await expect(panel.getByRole("status")).not.toContainText("合わない名前");

  // 自動で読む（10分ごと）をオンにすると、稼働表に「シートから読んだ」が出る
  await panel.getByRole("switch", { name: "自動で読む" }).click();
  await expect(page.getByText("自動で読むようにしました（10分ごと）")).toBeVisible();
  await page.goto("/events/board");
  await expect(page.getByTestId("sheet-sync-note")).toContainText("シートから読んだ");
});

test("自動実行の入り口は合言葉（CRON_SECRET）がないと動かず、あれば読む", async ({ request }) => {
  await setTab(request);
  await sql(`insert into settings (key, value) values ('sheet_sync', $1) on conflict (key) do update set value = excluded.value`, [
    { enabled: true, spreadsheet_id: "E2E_SYNC_SHEET_0123456789", role_id: null },
  ]);
  const bad = await request.get("/api/cron/sheet-sync", { headers: { authorization: "Bearer wrong" } });
  expect(bad.status()).toBe(401);
  const good = await request.get("/api/cron/sheet-sync", { headers: { authorization: "Bearer e2e-cron" } });
  expect(good.status()).toBe(200);
  const body = (await good.json()) as { ok: boolean; message: string };
  expect(body.ok).toBe(true);
  expect(body.message).toContain(`${tab}:`);
});

test("管理者には設定の画面がない（データ取り込みはオーナーだけ）", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "e2e/.auth/manager.json" });
  const page = await ctx.newPage();
  const r = await page.goto("/import");
  expect(r?.status()).toBe(404);
  await ctx.close();
});
