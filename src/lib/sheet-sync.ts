/**
 * 管理用スプレッドシートを自動で読む（Phase 18。シートが正、CRM が追いかける）。
 *
 * 10分ごとの自動実行（/api/cron/sheet-sync）と「今すぐ読む」から呼ばれる。ログインしていない処理なので
 * 秘密キーで DB に入れるが、やることは画面の「月の稼働表」の取り込みと同じ計算（month-sheet-plan / month-sheet-apply）。
 * - 今月・来月のタブ（「202611」）を読む。Google の設定（サービスアカウント）があればそれで、
 *   なければリンク共有のシートを CSV として読む
 * - 名簿にない人・ない会場・取引先は作らず、「合わない名前」として記録に残す（画面で対応づける）
 * - シートから入れたものは台帳（sheet_sync_items）に残し、シートから消えたら CRM からも外す
 *   （今日より前の分・報告や実績のある分・CRM だけで入れたものは残す）
 * 結果は sheet_syncs に残す（金額は入れない）。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCsv } from "@/lib/csv";
import { monthRange, todayJst, type DateString } from "@/lib/date";
import { getAccessToken, readServiceAccount, SheetError, SheetsClient } from "@/lib/google/sheets";
import { parseMonthSheet } from "@/lib/import/month-sheet";
import { applyMonthSheetPlan, type ApplyResult } from "@/lib/import/month-sheet-apply";
import { buildPlan, type MonthSheetPlan, type PlanContext } from "@/lib/import/month-sheet-plan";
import { autoChoices, mergeUnmatched, publicCsvUrl, type SheetAlias, syncMonths, tabTitle, type Unmatched, vanished } from "@/lib/import/sheet-sync-plan";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { selectAll } from "@/lib/supabase/select-all";

type Db = SupabaseClient<Database>;

export type SheetSyncSettings = { enabled: boolean; spreadsheetId: string | null; roleId: string | null; writeback: boolean };

export type SyncMonthReport = {
  month: string;
  tab: string;
  ok: boolean;
  message: string;
  eventsCreated: number;
  eventsReused: number;
  assignments: number;
  availability: number;
  rates: number;
  dailyRates: number;
  removed: { events: number; assignments: number; availability: number };
  /** シートから消えたが CRM に残したもの（理由つき） */
  kept: string[];
  warnings: string[];
};

export type SyncReport = { months: SyncMonthReport[]; unmatched: Unmatched };

export const EMPTY_UNMATCHED: Unmatched = { clients: [], venues: [], staff: [], places: [] };

const NOT_SHARED = "スプレッドシートを読めません。リンクを知っている全員が見られる共有にするか、Google の設定（docs/setup.md の「シートへの自動書き出し」）をしてください";

/** 読む元の設定（settings の sheet_sync。読む元が空なら書き出し先と同じシート） */
export async function getSheetSyncSettings(db: Db): Promise<SheetSyncSettings> {
  const { data } = await db.from("settings").select("key, value").in("key", ["sheet_sync", "sheet_export"]);
  const map = new Map((data ?? []).map((r) => [r.key, (r.value ?? {}) as Record<string, unknown>]));
  const sync = map.get("sheet_sync") ?? {};
  const exp = map.get("sheet_export") ?? {};
  const id = (v: unknown) => (typeof v === "string" && v ? v : null);
  return { enabled: sync.enabled === true, spreadsheetId: id(sync.spreadsheet_id) ?? id(exp.spreadsheet_id), roleId: id(sync.role_id), writeback: sync.writeback === true };
}

type Reader = (tab: string) => Promise<{ rows: string[][] } | { error: string }>;

/** タブを読む手段: Google の設定があればサービスアカウント、なければリンク共有のシートを CSV で */
async function makeReader(spreadsheetId: string, fetchImpl: typeof fetch = fetch): Promise<Reader> {
  const sa = readServiceAccount();
  if (sa) {
    const client = new SheetsClient(await getAccessToken(sa, fetchImpl), spreadsheetId, sa.client_email, fetchImpl);
    let titles: string[] | null = null;
    return async (tab) => {
      try {
        titles ??= await client.sheetTitles();
        if (!titles.includes(tab)) return { error: `「${tab}」タブがまだありません` };
        return { rows: await client.readValues(tab) };
      } catch (e) {
        return { error: e instanceof SheetError ? e.message.replace("書き込めません", "読めません").replace("「編集者」", "「閲覧者」") : "スプレッドシートを読めませんでした" };
      }
    };
  }
  const base = process.env.GOOGLE_DOCS_BASE || undefined;
  return async (tab) => {
    try {
      const res = await fetchImpl(publicCsvUrl(spreadsheetId, tab, base), { headers: { accept: "text/csv" } });
      if (res.status === 400) return { error: `「${tab}」タブがまだありません` };
      if (res.status === 401 || res.status === 403) return { error: NOT_SHARED };
      if (res.status === 404) return { error: "スプレッドシートが見つかりません。URL を確認してください" };
      if (!res.ok) return { error: `スプレッドシートを読めませんでした（${res.status}）` };
      const text = await res.text();
      if (/^\s*</.test(text)) return { error: NOT_SHARED };
      return { rows: parseCsv(text) };
    } catch {
      return { error: "スプレッドシートを読めませんでした。時間をおいてもう一度試してください" };
    }
  };
}

async function loadContext(db: Db, month: string, today: DateString): Promise<PlanContext> {
  const { start, end } = monthRange(month);
  const [clients, venues, staff, events] = await Promise.all([
    selectAll((f, t) => db.from("companies").select("id, name").eq("kind", "client").order("id").range(f, t)),
    selectAll((f, t) => db.from("venues").select("id, name").order("id").range(f, t)),
    selectAll((f, t) => db.from("staff").select("id, name").order("id").range(f, t)),
    selectAll((f, t) => db.from("events").select("id, date, client_id, venue_id").gte("date", start).lte("date", end).is("cancelled_at", null).order("id").range(f, t)),
  ]);
  return { today, clients, venues, staff, events };
}

const count = (v: unknown): number => (Array.isArray(v) ? Number((v[0] as { count?: number } | undefined)?.count ?? 0) : typeof v === "number" ? v : 0);
const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/**
 * 台帳を更新し、シートから消えたものを CRM から外す。
 * 外すのは今日以降で、報告・実績・経費・メモのないもの。CRM だけで入れたもの（台帳にないもの）には触らない。
 */
async function reconcile(db: Db, month: string, plan: MonthSheetPlan, applied: ApplyResult, today: DateString) {
  const monthDate = `${month}-01`;
  const now = new Date().toISOString();
  const removed = { events: 0, assignments: 0, availability: 0 };
  const kept: string[] = [];
  // 台帳から外すもの（消したもの・もう存在しないもの）。残したものは台帳に残し、次の読み取りでもう一度見る
  const drop: number[] = [];

  const presentEvents = [...new Set(plan.events.map((e) => applied.eventIds[e.key]).filter(Boolean))];
  const presentAssignments = new Set(plan.assignments.map((a) => `${applied.eventIds[a.eventKey]}|${a.staffId}`));
  const presentAvailability = new Set(applied.availabilityKeys);

  // 1. 台帳に入れる（現場・稼働可能日はシートにある全部、アサインは今回作った分）
  const rows = [
    ...presentEvents.map((id) => ({ month: monthDate, kind: "event", key: id, ref_id: id, last_seen_at: now })),
    ...applied.createdAssignments.map((a) => ({ month: monthDate, kind: "assignment", key: `${a.event_id}|${a.staff_id}`, ref_id: a.id, last_seen_at: now })),
    ...[...presentAvailability].map((key) => ({ month: monthDate, kind: "availability", key, ref_id: null, last_seen_at: now })),
  ];
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("sheet_sync_items").upsert(rows.slice(i, i + 500), { onConflict: "month,kind,key" });
    if (error) throw new SheetError(`台帳に書けませんでした（${error.message}）`);
  }

  // 2. 台帳にあってシートにないもの
  const ledger = await selectAll((f, t) => db.from("sheet_sync_items").select("id, kind, key, ref_id").eq("month", monthDate).order("id").range(f, t));
  const gone = {
    assignment: vanished(ledger.filter((r) => r.kind === "assignment"), presentAssignments),
    event: vanished(ledger.filter((r) => r.kind === "event"), presentEvents),
    availability: vanished(ledger.filter((r) => r.kind === "availability"), presentAvailability),
  };

  // 3-1. アサイン: 今日以降・報告や実績や経費やメモがないものだけ消す（確定連絡のお知らせは一緒に消える）
  for (const g of gone.assignment) {
    if (!g.ref_id) {
      drop.push(g.id);
      continue;
    }
    const { data: a } = await db
      .from("assignments")
      .select("id, status, event:events!inner(date, venue:venues(name)), staff:staff(name), report:reports(submitted_at), report_items(count), expenses(count), staff_notes(count)")
      .eq("id", g.ref_id)
      .maybeSingle();
    if (!a) {
      drop.push(g.id);
      continue;
    }
    const ev = one(a.event);
    const label = `${one(a.staff)?.name ?? ""} ${ev?.date?.slice(5).replace("-", "/") ?? ""} ${one(ev?.venue)?.name ?? ""}`.trim();
    const hasData = Boolean(one(a.report)?.submitted_at) || count(a.report_items) > 0 || count(a.expenses) > 0 || count(a.staff_notes) > 0;
    const future = (ev?.date ?? "") >= today;
    const open = ["confirmed", "offered", "waitlisted"].includes(a.status);
    if (!future || hasData || !open) {
      kept.push(`${label}（${!future ? "過去の分" : hasData ? "報告・実績あり" : "状態が変わっている"}）`);
      continue;
    }
    await db.from("assignment_private").delete().eq("assignment_id", a.id);
    await db.from("reports").delete().eq("assignment_id", a.id).is("submitted_at", null);
    const { error } = await db.from("assignments").delete().eq("id", a.id);
    if (error) kept.push(`${label}（消せませんでした）`);
    else {
      removed.assignments++;
      drop.push(g.id);
    }
  }

  // 3-2. 現場: 今日以降・誰も入っていない・中止でないものだけ消す
  for (const g of gone.event) {
    if (!g.ref_id) {
      drop.push(g.id);
      continue;
    }
    const { data: e } = await db.from("events").select("id, date, cancelled_at, venue:venues(name), assignments(count)").eq("id", g.ref_id).maybeSingle();
    if (!e) {
      drop.push(g.id);
      continue;
    }
    const label = `${e.date.slice(5).replace("-", "/")} ${one(e.venue)?.name ?? ""}`;
    if (e.date < today || e.cancelled_at || count(e.assignments) > 0) {
      kept.push(`現場 ${label}（${e.date < today ? "過去の分" : e.cancelled_at ? "中止にしてある" : "人が入っている"}）`);
      continue;
    }
    await db.from("event_rates").delete().eq("event_id", e.id);
    await db.from("event_incentive_rates").delete().eq("event_id", e.id);
    await db.from("event_requirements").delete().eq("event_id", e.id);
    const { error } = await db.from("events").delete().eq("id", e.id);
    if (error) kept.push(`現場 ${label}（消せませんでした）`);
    else {
      removed.events++;
      drop.push(g.id);
    }
  }

  // 3-3. 稼働可能日: 管理者が入れた分だけ消す（本人が出した分はそのまま）
  for (const g of gone.availability) {
    const [staffId, date] = g.key.split("|");
    if (!staffId || !date) continue;
    const { data } = await db.from("availability").delete().eq("staff_id", staffId).eq("date", date).eq("source", "admin").select("staff_id");
    removed.availability += data?.length ?? 0;
    drop.push(g.id);
  }

  // 4. 台帳から外す（残したものは残す）
  for (let i = 0; i < drop.length; i += 500) await db.from("sheet_sync_items").delete().in("id", drop.slice(i, i + 500));

  return { removed, kept };
}

function summarize(months: SyncMonthReport[], unmatched: Unmatched): string {
  const parts = months.map((m) => {
    if (!m.ok) return `${m.tab}: ${m.message}`;
    const bits = [`現場 +${m.eventsCreated}`, `人 +${m.assignments}`, `○△× ${m.availability}`];
    const removed = m.removed.events + m.removed.assignments + m.removed.availability;
    if (removed) bits.push(`外した ${removed}`);
    return `${m.tab}: ${bits.join("・")}`;
  });
  const n = unmatched.clients.length + unmatched.venues.length + unmatched.staff.length + unmatched.places.length;
  if (n) parts.push(`合わない名前 ${n}件`);
  return parts.join(" / ");
}

export async function runSheetSync(source: "cron" | "button", opts: { fetchImpl?: typeof fetch; now?: Date } = {}): Promise<{ ok: boolean; message: string; report?: SyncReport }> {
  const admin = createAdminClient();
  const log = async (ok: boolean, message: string, report: SyncReport = { months: [], unmatched: EMPTY_UNMATCHED }) => {
    await admin.from("sheet_syncs").insert({ ok, message, source, report });
    return { ok, message, report };
  };

  const settings = await getSheetSyncSettings(admin);
  if (source === "cron" && !settings.enabled) return { ok: false, message: "シートを自動で読む設定がオフです" };
  if (!settings.spreadsheetId) return source === "cron" ? { ok: false, message: "読む元のスプレッドシートが未設定です" } : log(false, "読む元のスプレッドシートが未設定です");
  const roleId = settings.roleId ?? (await admin.from("roles").select("id").eq("is_active", true).order("sort_order").limit(1).maybeSingle()).data?.id;
  if (!roleId) return log(false, "人数を入れる役割がありません。設定で役割を作ってください");

  const today = todayJst(opts.now);
  let reader: Reader;
  try {
    reader = await makeReader(settings.spreadsheetId, opts.fetchImpl);
  } catch (e) {
    return log(false, e instanceof SheetError ? e.message : "Google にログインできませんでした");
  }
  const { data: aliasRows } = await admin.from("sheet_name_aliases").select("kind, sheet_name, target_id");
  const aliases = (aliasRows ?? []) as SheetAlias[];

  const months: SyncMonthReport[] = [];
  let unmatched: Unmatched = EMPTY_UNMATCHED;
  for (const month of syncMonths(today)) {
    const tab = tabTitle(month);
    const base: SyncMonthReport = { month, tab, ok: false, message: "", eventsCreated: 0, eventsReused: 0, assignments: 0, availability: 0, rates: 0, dailyRates: 0, removed: { events: 0, assignments: 0, availability: 0 }, kept: [], warnings: [] };
    const read = await reader(tab);
    if ("error" in read) {
      months.push({ ...base, message: read.error });
      continue;
    }
    const parsed = parseMonthSheet(read.rows);
    if (!parsed.days.length) {
      months.push({ ...base, message: parsed.warnings[0] ?? "月のシートとして読めませんでした" });
      continue;
    }
    try {
      const ctx = await loadContext(admin, month, today);
      const auto = autoChoices(parsed, ctx, month, aliases);
      unmatched = mergeUnmatched(unmatched, auto.unmatched);
      const plan = buildPlan(auto.parsed, ctx, auto.choices);
      const r = await applyMonthSheetPlan(admin, plan, roleId, { sheetWins: true });
      if (!r.ok || !r.data) {
        months.push({ ...base, message: r.message ?? "取り込めませんでした" });
        continue;
      }
      const { removed, kept } = await reconcile(admin, month, plan, r.data, today);
      months.push({
        ...base,
        ok: true,
        eventsCreated: r.data.eventsCreated,
        eventsReused: r.data.eventsReused,
        assignments: r.data.assignments,
        availability: r.data.availability,
        rates: r.data.rates,
        dailyRates: r.data.dailyRates,
        removed,
        kept,
        warnings: parsed.warnings.slice(0, 20),
      });
    } catch (e) {
      console.error("[sheet-sync]", month, e);
      months.push({ ...base, message: e instanceof SheetError ? e.message : "取り込みの途中で止まりました。時間をおいてもう一度試してください" });
    }
  }
  const report = { months, unmatched };
  return log(months.some((m) => m.ok), summarize(months, unmatched), report);
}
