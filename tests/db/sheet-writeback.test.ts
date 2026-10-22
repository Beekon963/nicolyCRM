/**
 * CRM で入れたものをシートにも書く（書き戻し。Phase 19）。
 * - トリガーが「書き直すマス」を待ち行列に入れる（同じマスは1つ）
 * - 定期実行が CRM の今の状態を読み直し、偽の Google のタブと比べて、違うマスだけ書く
 * - オフなら印を捨てる。Google の設定がなければ書かずに残す
 */
import { generateKeyPairSync } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closePool, getPool, localSupabase } from "./helpers";

const SHEET_ID = "WB_TEST_SHEET_0123456789";
const NOW = new Date("2031-05-10T03:00:00Z"); // 日本時間 2031-05-10 → 今月のタブは 203105
const MONTH = "2031-05";
const day = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`;
const tag = Math.random().toString(36).slice(2, 7);
const names = { client: `書戻テスト取引先${tag}`, venue: `書戻テスト会場${tag}`, venue2: `書戻テスト会場B${tag}`, staff: `書戻 太郎${tag}` };
let clientId = "";
let venueId = "";
let venue2Id = "";
let staffId = "";
let roleId = "";

/** 偽のタブ（書き込みは反映する） */
let tab: string[][] = [];
let batchBodies: unknown[] = [];
function freshTab(): string[][] {
  const cols = Array.from({ length: 31 }, (_, i) => `5/${i + 1}`);
  const row = (head: string[], cells: Record<number, string> = {}) => {
    const r = Array<string>(4 + 31).fill("");
    head.forEach((v, i) => (r[i] = v));
    for (const [d, v] of Object.entries(cells)) r[3 + Number(d)] = v;
    return r;
  };
  return [
    ["", "", "", "日付", ...cols, "出勤日数"],
    ["ランク", "名前", "最寄り駅", "曜日", ...cols.map(() => "月")],
    row([names.client, "", "", "単価"]),
    row(["", "", "", "現場"]),
    row(["", "", "", "人数"]),
    row(["A", names.staff, "大宮", "単価"]),
    row(["", "", "", "場所"]),
    row(["", "", "", "シフト"], { 20: "⭕️" }),
  ];
}
const a1ToRc = (a1: string): { r: number; c: number } => {
  const m = a1.match(/^([A-Z]+)(\d+)$/)!;
  let c = 0;
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(m[2]) - 1, c: c - 1 };
};
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://oauth2.googleapis.com/")) return Response.json({ access_token: "ya29.test" });
  if (url.includes("?fields=sheets.properties.title")) return Response.json({ sheets: [{ properties: { title: "203105" } }] });
  if (url.includes("/values:batchUpdate")) {
    const body = JSON.parse(String(init?.body)) as { data: { range: string; values: string[][] }[] };
    batchBodies.push(body);
    for (const d of body.data) {
      const { r, c } = a1ToRc(d.range.split("!")[1]);
      tab[r] ??= [];
      tab[r][c] = d.values[0][0];
    }
    return Response.json({});
  }
  if (url.includes("/values/'203105'")) return Response.json({ values: tab });
  return Response.json({}, { status: 404 });
};
const cellOf = (a1: string) => {
  const { r, c } = a1ToRc(a1);
  return tab[r]?.[c] ?? "";
};
async function run(source: "cron" | "button" = "button", now: Date = NOW) {
  const { runSheetWriteback } = await import("@/lib/sheet-writeback");
  return runSheetWriteback(source, { fetchImpl: fakeFetch, now });
}
const q = (text: string, params: unknown[] = []) => getPool().query(text, params);
const pendingFor = async (kind: string, ref: string, d: string) => (await q(`select count(*)::int as n from public.sheet_writes where status = 'pending' and kind = $1 and ref_id = $2 and date = $3`, [kind, ref, d])).rows[0].n as number;
const setSettings = (writeback: boolean) => q(`insert into public.settings (key, value) values ('sheet_sync', $1) on conflict (key) do update set value = excluded.value`, [{ enabled: false, spreadsheet_id: SHEET_ID, role_id: null, writeback }]);

async function cleanupMonth() {
  const c = await getPool().connect();
  try {
    await c.query("begin");
    await c.query("set local session_replication_role = replica");
    const ev = `(select id from public.events where date between $1 and $2)`;
    const asg = `(select id from public.assignments where event_id in ${ev})`;
    for (const t of ["report_items", "reports", "expenses", "staff_notes", "assignment_private", "line_outbox", "assignment_alerts"]) await c.query(`delete from public.${t} where assignment_id in ${asg}`, [day(1), day(31)]);
    await c.query(`delete from public.assignments where event_id in ${ev}`, [day(1), day(31)]);
    for (const t of ["event_rates", "event_incentive_rates", "event_requirements"]) await c.query(`delete from public.${t} where event_id in ${ev}`, [day(1), day(31)]);
    await c.query(`delete from public.events where date between $1 and $2`, [day(1), day(31)]);
    await c.query(`delete from public.availability where date between $1 and $2`, [day(1), day(31)]);
    await c.query(`delete from public.sheet_writes where date between $1 and $2`, [day(1), day(31)]);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

beforeAll(async () => {
  const s = localSupabase() as { API_URL: string; SECRET_KEY: string };
  process.env.NEXT_PUBLIC_SUPABASE_URL = s.API_URL;
  process.env.SUPABASE_SECRET_KEY = s.SECRET_KEY;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "wb@test-project.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() });
  clientId = (await q(`insert into public.companies (kind, name, status) values ('client', $1, 'active') returning id`, [names.client])).rows[0].id;
  venueId = (await q(`insert into public.venues (name) values ($1) returning id`, [names.venue])).rows[0].id;
  venue2Id = (await q(`insert into public.venues (name) values ($1) returning id`, [names.venue2])).rows[0].id;
  staffId = (await q(`insert into public.staff (name, kana) values ($1, 'かきもどし') returning id`, [names.staff])).rows[0].id;
  roleId = (await q(`select id from public.roles where is_active order by sort_order limit 1`)).rows[0].id;
  await cleanupMonth();
  // ほかのテスト・ダミーデータが付けた印は捨てる（このテストでは自分の分だけを見る）
  await q(`delete from public.sheet_writes where status = 'pending'`);
});

afterEach(async () => {
  await q(`delete from public.settings where key = 'sheet_sync'`);
});

afterAll(async () => {
  await cleanupMonth();
  await q(`delete from public.sheet_writes where ref_id = any($1)`, [[clientId, staffId]]);
  await q(`delete from public.staff where id = $1`, [staffId]);
  await q(`delete from public.venues where id = any($1)`, [[venueId, venue2Id]]);
  await q(`delete from public.companies where id = $1`, [clientId]);
  await closePool();
});

describe("書き戻し", () => {
  it("予定・現場・人数・○△× が変わると、書き直すマスに印が付く（同じマスは1つ）", async () => {
    const ev = (await q(`insert into public.events (client_id, venue_id, date) values ($1, $2, $3) returning id`, [clientId, venueId, day(13)])).rows[0].id;
    expect(await pendingFor("client_day", clientId, day(13))).toBe(1);
    await q(`insert into public.event_requirements (event_id, role_id, required_count) values ($1, $2, 2)`, [ev, roleId]);
    expect(await pendingFor("client_day", clientId, day(13))).toBe(1);
    const asg = (await q(`insert into public.assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'offered') returning id`, [ev, staffId, roleId])).rows[0].id;
    expect(await pendingFor("staff_day", staffId, day(13))).toBe(1);
    await q(`update public.assignments set status = 'confirmed' where id = $1`, [asg]);
    expect(await pendingFor("staff_day", staffId, day(13))).toBe(1);
    await q(`insert into public.availability (staff_id, date, status, source) values ($1, $2, 'ok', 'self')`, [staffId, day(14)]);
    expect(await pendingFor("availability", staffId, day(14))).toBe(1);
    // 現場の日付を動かすと、前の日と新しい日の両方に印が付く（入っている人の日も）
    await q(`update public.events set date = $2 where id = $1`, [ev, day(15)]);
    expect(await pendingFor("client_day", clientId, day(15))).toBe(1);
    expect(await pendingFor("staff_day", staffId, day(15))).toBe(1);
    await q(`update public.events set date = $2 where id = $1`, [ev, day(13)]);
  });

  it("CRM の今の状態をタブと比べて、違うマスだけ書く。もう一度動かしても何も書かない", async () => {
    await setSettings(true);
    tab = freshTab();
    batchBodies = [];
    const r = await run();
    expect(r.ok).toBe(true);
    expect(r.written).toBe(4);
    // 13日 = 4 + 13 列目 → Q（A=1 … Q=17）。上の段: 現場 4行目・人数 5行目、下の段: 場所 7行目、シフト 8行目は 14日 = R
    expect(cellOf("Q4")).toBe(names.venue);
    expect(cellOf("Q5")).toBe("2");
    expect(cellOf("Q7")).toBe(names.venue);
    expect(cellOf("R8")).toBe("⭕️");
    const { rows } = await q(`select status, message from public.sheet_writes where ref_id = any($1) and status <> 'pending' order by id`, [[clientId, staffId]]);
    expect(rows.every((x) => x.status === "done")).toBe(true);
    expect(rows.map((x) => x.message).join("\n")).toContain("場所に「");
    // 2回目: 印がないので何もしない
    const again = await run();
    expect(again.message).toContain("書くものはありません");
    expect(batchBodies).toHaveLength(1);
  });

  it("○→× に変えると書き換え、辞退にすると場所を消す。CRM の会場と合わないマスは触らない", async () => {
    await setSettings(true);
    batchBodies = [];
    await q(`update public.availability set status = 'ng' where staff_id = $1 and date = $2`, [staffId, day(14)]);
    await q(`update public.assignments set status = 'declined' where staff_id = $1`, [staffId]);
    // シートにだけある（CRM の会場と合わない）場所
    tab[6][3 + 20] = "よその現場";
    await q(`insert into public.sheet_writes (kind, ref_id, date) values ('staff_day', $1, $2)`, [staffId, day(20)]);
    const r = await run();
    expect(r.ok).toBe(true);
    expect(cellOf("R8")).toBe("❌");
    expect(cellOf("Q7")).toBe("");
    expect(cellOf("X7")).toBe("よその現場");
    const { rows } = await q(`select status, message from public.sheet_writes where ref_id = $1 and date = $2 and status <> 'pending' order by id desc limit 1`, [staffId, day(20)]);
    expect(rows[0].status).toBe("skipped");
    expect(rows[0].message).toContain("合わないので触りません");
  });

  it("シートに行がない人は書けずに知らせる。自動実行は印が付いてから1分たったものだけ", async () => {
    await setSettings(true);
    const other = (await q(`insert into public.staff (name, kana) values ($1, 'いない') returning id`, [`書戻 いない人${tag}`])).rows[0].id;
    try {
      await q(`insert into public.availability (staff_id, date, status, source) values ($1, $2, 'maybe', 'admin')`, [other, day(16)]);
      expect(await pendingFor("availability", other, day(16))).toBe(1);
      // 自動実行は、印が付いてから1分たったものだけ（今の時刻で動かすと、付けたばかりの印は見ない）
      const cron = await run("cron", new Date());
      expect(cron.message).toContain("書くものはありません");
      const r = await run("button");
      expect(r.failed).toBe(1);
      const { rows } = await q(`select status, message from public.sheet_writes where ref_id = $1 order by id desc limit 1`, [other]);
      expect(rows[0].status).toBe("failed");
      expect(rows[0].message).toContain("行がありません");
    } finally {
      await q(`delete from public.sheet_writes where ref_id = $1`, [other]);
      await q(`delete from public.availability where staff_id = $1`, [other]);
      await q(`delete from public.staff where id = $1`, [other]);
    }
  });

  it("オフなら印を捨てる。Google の設定がなければ書かずに残す", async () => {
    await setSettings(false);
    await q(`insert into public.sheet_writes (kind, ref_id, date) values ('availability', $1, $2)`, [staffId, day(14)]);
    const off = await run("cron");
    expect(off.ok).toBe(false);
    expect(off.message).toContain("オフ");
    expect(await pendingFor("availability", staffId, day(14))).toBe(0);

    await setSettings(true);
    const saved = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    try {
      await q(`insert into public.sheet_writes (kind, ref_id, date) values ('availability', $1, $2)`, [staffId, day(14)]);
      const r = await run("button");
      expect(r.ok).toBe(false);
      expect(r.message).toContain("Google の設定");
      const { rows } = await q(`select status from public.sheet_writes where ref_id = $1 and date = $2 order by id desc limit 1`, [staffId, day(14)]);
      expect(rows[0].status).toBe("skipped");
    } finally {
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON = saved;
    }
  });
});
