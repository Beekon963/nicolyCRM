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

/** 偽のタブ（書き込みは反映する。行を足す指示も反映する） */
let tab: string[][] = [];
let batchBodies: unknown[] = [];
/** 行を足す・書式を写す指示（values 以外の batchUpdate） */
let structureBodies: { requests: Record<string, unknown>[] }[] = [];
/** values:batchUpdate の valueInputOption（計算式は USER_ENTERED で書く） */
let inputOptions: string[] = [];
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
    // 右端（AJ 列）に手本の計算式（足した組に行をずらして写される）
    [...row(["", "", "", "現場"]), "=COUNTA(E4:AI4)"],
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
  if (url.includes("?fields=sheets(properties(sheetId,title))")) return Response.json({ sheets: [{ properties: { title: "203105", sheetId: 77 } }] });
  if (url.includes("/values:batchUpdate")) {
    const body = JSON.parse(String(init?.body)) as { valueInputOption: string; data: { range: string; values: string[][] }[] };
    batchBodies.push(body);
    inputOptions.push(body.valueInputOption);
    for (const d of body.data) {
      const { r, c } = a1ToRc(d.range.split("!")[1]);
      tab[r] ??= [];
      tab[r][c] = d.values[0][0];
    }
    return Response.json({});
  }
  if (url.split("?")[0].endsWith(":batchUpdate")) {
    const body = JSON.parse(String(init?.body)) as { requests: Record<string, unknown>[] };
    structureBodies.push(body);
    for (const r of body.requests) {
      const ins = r.insertDimension as { range: { startIndex: number; endIndex: number } } | undefined;
      if (ins) {
        const width = tab[0]?.length ?? 0;
        tab.splice(ins.range.startIndex, 0, ...Array.from({ length: ins.range.endIndex - ins.range.startIndex }, () => Array<string>(width).fill("")));
      }
    }
    return Response.json({});
  }
  // 行の範囲を計算式のまま読む（'203105'!6:8）
  const range = url.match(/\/values\/'203105'!(\d+):(\d+)\?valueRenderOption=FORMULA/);
  if (range) return Response.json({ values: tab.slice(Number(range[1]) - 1, Number(range[2])) });
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
const setSettings = (writeback: boolean, extra: Record<string, unknown> = {}) =>
  q(`insert into public.settings (key, value) values ('sheet_sync', $1) on conflict (key) do update set value = excluded.value`, [{ enabled: false, spreadsheet_id: SHEET_ID, role_id: null, writeback, ...extra }]);

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

  it("行がない人・取引先は、設定がオンなら組を足してから書く。似た名前の行があるときは足さない（Phase 20）", async () => {
    await setSettings(true, { add_rows: true });
    tab = freshTab();
    batchBodies = [];
    structureBodies = [];
    inputOptions = [];
    const newbie = (await q(`insert into public.staff (name, kana, nearest_station) values ($1, 'かきもどし しんじん', '浦和') returning id`, [`書戻 新人${tag}`])).rows[0].id;
    const twin = (await q(`insert into public.staff (name, kana) values ($1, 'べっせい はなこ') returning id`, [`別姓${tag} 花子`])).rows[0].id;
    const newClient = (await q(`insert into public.companies (kind, name, status) values ('client', $1, 'active') returning id`, [`書戻テスト新規取引先${tag}`])).rows[0].id;
    try {
      // 名字だけの行（別姓…）がある → 花子の行は足さない
      tab.push(...[["B", `別姓${tag}`, "", "単価"], ["", "", "", "場所"], ["", "", "", "シフト"]].map((h) => [...h, ...Array<string>(31).fill("")]));
      await q(`insert into public.availability (staff_id, date, status, source) values ($1, $2, 'ok', 'admin')`, [newbie, day(17)]);
      await q(`insert into public.availability (staff_id, date, status, source) values ($1, $2, 'ok', 'admin')`, [twin, day(18)]);
      const ev = (await q(`insert into public.events (client_id, venue_id, date) values ($1, $2, $3) returning id`, [newClient, venueId, day(19)])).rows[0].id;
      await q(`insert into public.event_requirements (event_id, role_id, required_count) values ($1, $2, 2)`, [ev, roleId]);

      const before = tab.length;
      const r = await run("button");
      expect(r.failed).toBe(1);
      expect(tab.length).toBe(before + 6);
      // 上の段のいちばん下（5〜7行目）に取引先の組。見出し・名前・現場・人数
      expect(tab[5][0]).toBe(`書戻テスト新規取引先${tag}`);
      expect(tab[5][3]).toBe("単価");
      expect(tab[6][3]).toBe("現場");
      expect(tab[7][3]).toBe("人数");
      expect(cellOf("W7")).toBe(names.venue); // 19日 = 4 + 19 列目 → W
      expect(cellOf("W8")).toBe("2");
      // 手本（4行目）の右端の計算式が、行をずらして写る（計算式として書く）
      expect(cellOf("AJ7")).toBe("=COUNTA(E7:AI7)");
      expect(inputOptions).toContain("USER_ENTERED");
      expect(cellOf("AJ8")).toBe("");
      // 下の段のいちばん下（別姓…の組の下。12〜14行目）にスタッフの組。名前・最寄り駅・シフト
      expect(tab[11][1]).toBe(`書戻 新人${tag}`);
      expect(tab[11][2]).toBe("浦和");
      expect(tab[11][3]).toBe("単価");
      expect(tab[12][3]).toBe("場所");
      expect(tab[13][3]).toBe("シフト");
      expect(cellOf("U14")).toBe("⭕️"); // 17日 = 4 + 17 列目 → U
      // 行を足す指示: 上の段は 5 行目の前に3行、書式は手本（3〜5行目）から
      expect(structureBodies[0].requests[0]).toEqual({ insertDimension: { range: { sheetId: 77, dimension: "ROWS", startIndex: 5, endIndex: 8 }, inheritFromBefore: true } });
      expect(structureBodies[0].requests[1]).toMatchObject({ copyPaste: { source: { startRowIndex: 2, endRowIndex: 5 }, destination: { startRowIndex: 5, endRowIndex: 8 }, pasteType: "PASTE_FORMAT" } });
      // 単価の行の日付のマスには何も書かない
      expect(tab[5].slice(4, 35).every((c) => c === "")).toBe(true);
      expect(tab[11].slice(4, 35).every((c) => c === "")).toBe(true);

      const { rows } = await q(`select ref_id, status, message from public.sheet_writes where ref_id = any($1) and status <> 'pending' order by id`, [[newbie, twin, newClient]]);
      const by = Object.fromEntries(rows.map((x) => [x.ref_id, x]));
      expect(by[newbie].status).toBe("done");
      expect(by[newbie].message).toContain("行を足しました。");
      expect(by[newClient].status).toBe("done");
      expect(by[twin].status).toBe("failed");
      expect(by[twin].message).toContain(`「別姓${tag}」の行がこの人かもしれないので、行は足しませんでした`);
    } finally {
      await q(`delete from public.sheet_writes where ref_id = any($1)`, [[newbie, twin, newClient]]);
      await q(`delete from public.availability where staff_id = any($1)`, [[newbie, twin]]);
      await cleanupMonth();
      await q(`delete from public.staff where id = any($1)`, [[newbie, twin]]);
      await q(`delete from public.companies where id = $1`, [newClient]);
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
