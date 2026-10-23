/**
 * 管理用スプレッドシートの自動の読み取り（Phase 18）。ローカルの DB に入れ、Google 側は偽物で受ける。
 * - リンク共有のシートを CSV で読む（Google の設定なし）/ サービスアカウントで読む
 * - 作る（現場・人数・確定・○△×・単価）→ シートから消えたら外す → 報告があるものは残す
 * - 名簿にない人は作らず「合わない名前」に出し、対応づけると次から入る
 */
import { generateKeyPairSync } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";
import { asRole, closePool, getPool, localSupabase } from "./helpers";

const SHEET_ID = "SYNC_TEST_SHEET_0123456789";
const NOW = new Date("2031-05-10T03:00:00Z"); // 日本時間 2031-05-10 12:00 → 読むタブは 203105・203106
const MONTH = "2031-05";
const day = (d: number) => `${MONTH}-${String(d).padStart(2, "0")}`;
const tag = Math.random().toString(36).slice(2, 7);

let clientId = "";
let venueId = "";
let staffId = "";
let staff2Id = "";
const names = { client: `同期テスト取引先${tag}`, venue: `同期テスト会場${tag}`, staff: `同期 太郎${tag}`, staff2: `同期 花子${tag}`, unknown: `名簿にない 人${tag}` };

/** 今のシートと同じ形の月のタブ（上の段: 単価/現場/人数、下の段: 単価/場所/シフト）。日は「今日」（10日）より後にする（前の日は記録のみになる） */
function sheetRows(opts: { eventDay3?: boolean; staffDay3?: boolean; okDay4?: boolean; unknownStaff?: boolean } = {}): string[][] {
  const o = { eventDay3: true, staffDay3: true, okDay4: true, unknownStaff: true, ...opts };
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
    row([names.client, "", "", "単価"], o.eventDay3 ? { 13: "¥20,000" } : {}),
    row(["", "", "", "現場"], o.eventDay3 ? { 13: names.venue } : {}),
    row(["", "", "", "人数"], o.eventDay3 ? { 13: "2" } : {}),
    row(["A", names.staff, "大宮", "単価"], o.staffDay3 ? { 13: "¥15,000" } : {}),
    row(["", "", "", "場所"], o.staffDay3 ? { 13: names.venue } : {}),
    row(["", "", "", "シフト"], o.okDay4 ? { 14: "⭕️", 15: "❌" } : {}),
    ...(o.unknownStaff ? [row(["B", names.unknown, "", "単価"]), row(["", "", "", "場所"], { 13: names.venue }), row(["", "", "", "シフト"], { 16: "🔺" })] : []),
  ];
}

/** 偽の Google: リンク共有のシートを CSV で読む URL に、タブごとの中身を返す */
function fakeFetch(tabs: Record<string, string[][]>, mode: "csv" | "html" | "api" = "csv"): typeof fetch {
  return async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (mode === "api") {
      if (url.startsWith("https://oauth2.googleapis.com/")) return Response.json({ access_token: "ya29.test" });
      if (url.includes("?fields=sheets.properties.title")) return Response.json({ sheets: Object.keys(tabs).map((title) => ({ properties: { title } })) });
      const m = url.match(/\/values\/'(\d{6})'/);
      if (m && tabs[m[1]]) return Response.json({ values: tabs[m[1]] });
      return Response.json({}, { status: 404 });
    }
    const u = new URL(url);
    if (!u.pathname.startsWith(`/spreadsheets/d/${SHEET_ID}/gviz/tq`)) throw new Error(`unexpected ${url} ${init?.method ?? ""}`);
    if (mode === "html") return new Response("<html><body>login</body></html>", { status: 200, headers: { "content-type": "text/html" } });
    const tab = u.searchParams.get("sheet") ?? "";
    if (!tabs[tab]) return new Response("Invalid query", { status: 400 });
    return new Response(toCsv(tabs[tab]), { status: 200, headers: { "content-type": "text/csv" } });
  };
}

async function run(tabs: Record<string, string[][]>, mode: "csv" | "html" | "api" = "csv", source: "cron" | "button" = "button") {
  const { runSheetSync } = await import("@/lib/sheet-sync");
  return runSheetSync(source, { fetchImpl: fakeFetch(tabs, mode), now: NOW });
}

const q = (text: string, params: unknown[] = []) => getPool().query(text, params);

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
    await c.query(`delete from public.sheet_sync_items where month = $1`, [day(1)]);
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
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_DOCS_BASE;
  clientId = (await q(`insert into public.companies (kind, name, status) values ('client', $1, 'active') returning id`, [names.client])).rows[0].id;
  venueId = (await q(`insert into public.venues (name) values ($1) returning id`, [names.venue])).rows[0].id;
  staffId = (await q(`insert into public.staff (name, kana) values ($1, 'どうき') returning id`, [names.staff])).rows[0].id;
  staff2Id = (await q(`insert into public.staff (name, kana) values ($1, 'どうき') returning id`, [names.staff2])).rows[0].id;
  await cleanupMonth();
});

afterEach(async () => {
  await q(`delete from public.settings where key = 'sheet_sync'`);
  await q(`delete from public.sheet_syncs where ran_at > now() - interval '10 minutes'`);
  await q(`delete from public.sheet_name_aliases where sheet_name like '%' || $1`, [tag]);
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
});

afterAll(async () => {
  await cleanupMonth();
  await q(`delete from public.staff_roles where staff_id = any($1)`, [[staffId, staff2Id]]);
  await q(`delete from public.staff where id = any($1)`, [[staffId, staff2Id]]);
  await q(`delete from public.venues where id = $1`, [venueId]);
  await q(`delete from public.company_billing where company_id = $1`, [clientId]);
  await q(`delete from public.companies where id = $1`, [clientId]);
  await closePool();
});

const enable = (enabled = true) => q(`insert into public.settings (key, value) values ('sheet_sync', $1) on conflict (key) do update set value = excluded.value`, [{ enabled, spreadsheet_id: SHEET_ID, role_id: null }]);

describe("シートの自動の読み取り", () => {
  it("読む元がないときは記録に残して止まる。自動実行は設定がオフなら何もしない", async () => {
    const r = await run({});
    expect(r.ok).toBe(false);
    expect(r.message).toContain("読む元のスプレッドシートが未設定");
    await enable(false);
    const c = await run({ "203105": sheetRows() }, "csv", "cron");
    expect(c.ok).toBe(false);
    expect(c.message).toContain("オフ");
    const { rows } = await q(`select ok from public.sheet_syncs where ran_at > now() - interval '10 minutes'`);
    expect(rows).toEqual([{ ok: false }]);
  });

  it("リンク共有のシートを読んで入れ、シートから消えたら外し、報告のあるものは残す。合わない名前は対応づけると次から入る", async () => {
    await enable();
    // 1. 入れる
    const r1 = await run({ "203105": sheetRows() });
    expect(r1.ok).toBe(true);
    expect(r1.message).toContain("203105: 現場 +1・人 +1・○△× 2");
    expect(r1.message).toContain("203106: 「203106」タブがまだありません");
    expect(r1.message).toContain("合わない名前 1件");
    expect(r1.report?.unmatched.staff).toEqual([names.unknown]);

    const ev = (await q(`select id, report_required from public.events where date = $1 and venue_id = $2 and client_id = $3`, [day(13), venueId, clientId])).rows;
    expect(ev).toHaveLength(1);
    expect(ev[0].report_required).toBe(true);
    const req = (await q(`select required_count from public.event_requirements where event_id = $1`, [ev[0].id])).rows;
    expect(req).toEqual([{ required_count: 2 }]);
    const asg = (await q(`select id, status, confirm_notice_sent_at is not null as sent from public.assignments where event_id = $1`, [ev[0].id])).rows;
    expect(asg).toEqual([{ id: expect.any(String), status: "confirmed", sent: true }]);
    const av = (await q(`select to_char(date, 'YYYY-MM-DD') as date, status, source from public.availability where staff_id = $1 order by date`, [staffId])).rows;
    expect(av).toEqual([
      { date: day(14), status: "ok", source: "admin" },
      { date: day(15), status: "ng", source: "admin" },
    ]);
    // 単価（オーナーだけの表）
    expect((await q(`select amount from public.event_rates where event_id = $1`, [ev[0].id])).rows).toEqual([{ amount: 20000 }]);
    expect((await q(`select daily_rate_override from public.assignment_private where assignment_id = $1`, [asg[0].id])).rows).toEqual([{ daily_rate_override: 15000 }]);
    // 台帳
    const ledger = (await q(`select kind, count(*)::int as n from public.sheet_sync_items where month = $1 group by kind order by kind`, [day(1)])).rows;
    expect(ledger).toEqual([
      { kind: "assignment", n: 1 },
      { kind: "availability", n: 2 },
      { kind: "event", n: 1 },
    ]);

    // 2. もう一度読んでも増えない。○ → × に変えるとシートに合わせる（本人が出した分は上書きしない）
    await q(`update public.availability set source = 'self' where staff_id = $1 and date = $2`, [staffId, day(15)]);
    const rows2 = sheetRows();
    rows2[7][3 + 14] = "❌";
    rows2[7][3 + 15] = "⭕️";
    const r2 = await run({ "203105": rows2 });
    expect(r2.ok).toBe(true);
    expect(r2.message).toContain("現場 +0・人 +0・○△× 1");
    expect((await q(`select count(*)::int as n from public.assignments where event_id = $1`, [ev[0].id])).rows[0].n).toBe(1);
    const av2 = (await q(`select to_char(date, 'YYYY-MM-DD') as date, status from public.availability where staff_id = $1 order by date`, [staffId])).rows;
    expect(av2).toEqual([
      { date: day(14), status: "ng" },
      { date: day(15), status: "ng" },
    ]);

    // 3. 対応づけると、次から入る（名簿にない人 → 花子）
    await q(`insert into public.sheet_name_aliases (kind, sheet_name, target_id) values ('staff', $1, $2)`, [names.unknown, staff2Id]);
    const r3 = await run({ "203105": rows2 });
    expect(r3.report?.unmatched.staff).toEqual([]);
    expect(r3.message).toContain("人 +1");
    const asg3 = (await q(`select staff_id from public.assignments where event_id = $1 order by created_at`, [ev[0].id])).rows.map((x) => x.staff_id);
    expect(asg3).toEqual([staffId, staff2Id]);

    // 4. 報告のある人はシートから消えても残す。ない人は外す。○△× も外す
    await q(`insert into public.reports (assignment_id, submitted_at, source) values ($1, now(), 'self')`, [asg[0].id]);
    const rows4 = sheetRows({ staffDay3: false, okDay4: false, unknownStaff: false });
    const r4 = await run({ "203105": rows4 });
    expect(r4.ok).toBe(true);
    const m4 = r4.report?.months[0];
    // 外した○△×は 太郎の14日と 花子の16日。本人が出した分（太郎の15日。self）は消さない
    expect(m4?.removed).toEqual({ events: 0, assignments: 1, availability: 2 });
    expect(m4?.kept).toEqual([expect.stringContaining("報告・実績あり")]);
    expect((await q(`select staff_id from public.assignments where event_id = $1`, [ev[0].id])).rows.map((x) => x.staff_id)).toEqual([staffId]);
    expect((await q(`select to_char(date, 'YYYY-MM-DD') as date, source from public.availability where staff_id = $1`, [staffId])).rows).toEqual([{ date: day(15), source: "self" }]);

    // 5. 現場がシートから消えても、人が入っている（報告あり）あいだは残す。人がいなくなれば消える
    const rows5 = sheetRows({ eventDay3: false, staffDay3: false, okDay4: false, unknownStaff: false });
    const r5 = await run({ "203105": rows5 });
    // 残したものは台帳に残るので、毎回「残した」と出る（報告のある人と、その人が入っている現場）
    expect(r5.report?.months[0].kept).toEqual([expect.stringContaining("報告・実績あり"), expect.stringContaining("人が入っている")]);
    expect((await q(`select count(*)::int as n from public.events where id = $1`, [ev[0].id])).rows[0].n).toBe(1);
    await q(`delete from public.reports where assignment_id = $1`, [asg[0].id]);
    await q(`delete from public.assignment_private where assignment_id = $1`, [asg[0].id]);
    await q(`delete from public.assignments where id = $1`, [asg[0].id]);
    // 台帳に残っている現場だけを見るので、もう一度読むと消える
    const r6 = await run({ "203105": rows5 });
    expect(r6.report?.months[0].removed.events).toBe(1);
    expect((await q(`select count(*)::int as n from public.events where id = $1`, [ev[0].id])).rows[0].n).toBe(0);
    expect((await q(`select count(*)::int as n from public.sheet_sync_items where month = $1`, [day(1)])).rows[0].n).toBe(0);
  });

  it("共有されていないシートは読めないと知らせる", async () => {
    await enable();
    const r = await run({ "203105": sheetRows() }, "html");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("リンクを知っている全員");
  });

  it("Google の設定があればサービスアカウントで読む", async () => {
    await cleanupMonth();
    await enable();
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: "sync@test-project.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() });
    const r = await run({ "203105": sheetRows({ unknownStaff: false }) }, "api");
    expect(r.ok).toBe(true);
    expect(r.message).toContain("203105: 現場 +1・人 +1");
    expect(r.message).toContain("203106: 「203106」タブがまだありません");
  });

  it("記録と対応づけの権限: 管理者は読めるが、対応づけを入れられるのはオーナーだけ。記録を入れるのはサーバーだけ", async () => {
    await enable();
    await run({ "203105": sheetRows({ unknownStaff: false }) });
    await asRole("manager", async (c) => {
      const { rows } = await c.query(`select count(*)::int as n from public.sheet_syncs where ran_at > now() - interval '10 minutes'`);
      expect(rows[0].n).toBeGreaterThan(0);
      await expect(c.query(`insert into public.sheet_syncs (ok, message, source) values (true, 'x', 'button')`)).rejects.toThrow();
      await expect(c.query(`insert into public.sheet_name_aliases (kind, sheet_name, target_id) values ('staff', $1, $2)`, [names.unknown, staff2Id])).rejects.toThrow();
    });
    await asRole("owner", async (c) => {
      await c.query(`insert into public.sheet_name_aliases (kind, sheet_name, target_id) values ('staff', $1, $2)`, [names.unknown, staff2Id]);
      const { rows } = await c.query(`select target_id from public.sheet_name_aliases where sheet_name = $1`, [names.unknown]);
      expect(rows).toEqual([{ target_id: staff2Id }]);
    });
  });
});
