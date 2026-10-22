/**
 * 月のシートの取り込み計画（month-sheet-plan.ts）を DB に入れる。
 * 画面からの取り込み（オーナーの権限）と、シートの自動の読み取り（サーバーの秘密キー）の両方で同じ処理を使う。
 *
 * - 現場: すでにあるものは使い回す。必要人数は選んだ役割で上書き（シートの人数が正）
 * - アサイン: 確定で入れる（確定連絡はシートの運用で済んでいるので送信済みにする）。すでに入っている人はそのまま
 * - 稼働可能日: 本人が出したものは上書きしない。管理者が入れたものは、sheetWins のときだけシートに合わせる
 * - 金額（請求単価・交通費別・日当）: オーナーだけが読める表に入れる
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import type { Database } from "@/lib/supabase/database.types";
import type { MonthSheetPlan, Ref } from "./month-sheet-plan";

type Db = SupabaseClient<Database>;

export type MonthSheetReport = {
  clients: number;
  venues: number;
  eventsCreated: number;
  eventsReused: number;
  assignments: number;
  availability: number;
  rates: number;
  dailyRates: number;
};

export type ApplyResult = MonthSheetReport & {
  /** 計画の現場の key → 現場の id（作ったもの・使い回したもの） */
  eventIds: Record<string, string>;
  /** 新しく作ったアサイン */
  createdAssignments: { id: string; event_id: string; staff_id: string }[];
  /** シートにあった稼働可能日（入れた・直した・そのままの全部） */
  availabilityKeys: string[];
};

export async function applyMonthSheetPlan(supabase: Db, plan: MonthSheetPlan, roleId: string, opts: { sheetWins?: boolean } = {}): Promise<ActionResult<ApplyResult>> {
  const report: ApplyResult = { clients: 0, venues: 0, eventsCreated: 0, eventsReused: 0, assignments: 0, availability: 0, rates: 0, dailyRates: 0, eventIds: {}, createdAssignments: [], availabilityKeys: [] };

  // 1. 新しい取引先・会場
  const newIds = new Map<string, string>();
  if (plan.newClients.length) {
    const { data, error } = await supabase
      .from("companies")
      .insert(plan.newClients.map((name) => ({ kind: "client" as const, name, status: "active" as const })))
      .select("id, name");
    if (error || !data) return fail(dbErrorMessage(error));
    data.forEach((c) => newIds.set(`client:${c.name}`, c.id));
    report.clients = data.length;
  }
  if (plan.newVenues.length) {
    const { data, error } = await supabase
      .from("venues")
      .insert(plan.newVenues.map((name) => ({ name })))
      .select("id, name");
    if (error || !data) return fail(dbErrorMessage(error));
    data.forEach((v) => newIds.set(`venue:${v.name}`, v.id));
    report.venues = data.length;
  }
  const idOf = (kind: "client" | "venue", r: Ref) => ("id" in r ? r.id : newIds.get(`${kind}:${r.newName}`)!);

  // 2. 現場（すでにあるものは使い回す）
  const eventId = new Map<string, string>();
  plan.events.filter((e) => e.existingId).forEach((e) => eventId.set(e.key, e.existingId!));
  report.eventsReused = eventId.size;
  const toCreate = plan.events.filter((e) => !e.existingId);
  if (toCreate.length) {
    const { data, error } = await supabase
      .from("events")
      .insert(toCreate.map((e) => ({ client_id: idOf("client", e.client), venue_id: idOf("venue", e.venue), date: e.date, report_required: !e.recordOnly })))
      .select("id");
    if (error || !data) return fail(dbErrorMessage(error));
    data.forEach((d, i) => eventId.set(toCreate[i].key, d.id));
    report.eventsCreated = data.length;
  }
  report.eventIds = Object.fromEntries(eventId);

  // 3. 必要人数（シートの人数。役割はシートにないので、選んだ役割で入れる）
  const reqs = plan.events.filter((e) => e.required > 0).map((e) => ({ event_id: eventId.get(e.key)!, role_id: roleId, required_count: e.required }));
  if (reqs.length) {
    const { error } = await supabase.from("event_requirements").upsert(reqs, { onConflict: "event_id,role_id" });
    if (error) return fail(dbErrorMessage(error));
  }

  // 4. アサイン（確定。確定連絡はシートの運用で済んでいるので送信済みにする）
  const now = new Date().toISOString();
  const asgRows = [...new Map(plan.assignments.map((a) => [`${eventId.get(a.eventKey)}|${a.staffId}`, a])).values()].map((a) => ({
    event_id: eventId.get(a.eventKey)!,
    staff_id: a.staffId,
    role_id: roleId,
    status: "confirmed" as const,
    responded_at: now,
    response_source: "admin" as const,
    confirm_notice_sent_at: now,
  }));
  if (asgRows.length) {
    const { data, error } = await supabase.from("assignments").upsert(asgRows, { onConflict: "event_id,staff_id", ignoreDuplicates: true }).select("id, event_id, staff_id");
    if (error) return fail(dbErrorMessage(error));
    report.assignments = data?.length ?? 0;
    report.createdAssignments = data ?? [];
  }

  // 5. 稼働可能日（本人が出したものは上書きしない）
  if (plan.availability.length) {
    const rows = plan.availability.map((a) => ({ staff_id: a.staffId, date: a.date, status: a.status, source: "admin" as const }));
    report.availabilityKeys = rows.map((r) => `${r.staff_id}|${r.date}`);
    if (opts.sheetWins) {
      // シートが正: 管理者が入れた分（source = admin）はシートに合わせ、本人が出した分（self）はそのまま
      const staffIds = [...new Set(rows.map((r) => r.staff_id))];
      const dates = rows.map((r) => r.date).sort();
      const { data: cur, error: e0 } = await supabase.from("availability").select("staff_id, date, status, source").in("staff_id", staffIds).gte("date", dates[0]).lte("date", dates[dates.length - 1]);
      if (e0) return fail(dbErrorMessage(e0));
      const existing = new Map((cur ?? []).map((r) => [`${r.staff_id}|${r.date}`, r]));
      const changes = rows.filter((r) => {
        const x = existing.get(`${r.staff_id}|${r.date}`);
        return !x || (x.source !== "self" && x.status !== r.status);
      });
      if (changes.length) {
        const { error } = await supabase.from("availability").upsert(changes.map((r) => ({ ...r, updated_at: now })), { onConflict: "staff_id,date" });
        if (error) return fail(dbErrorMessage(error));
      }
      report.availability = changes.length;
    } else {
      const { data, error } = await supabase.from("availability").upsert(rows, { onConflict: "staff_id,date", ignoreDuplicates: true }).select("staff_id");
      if (error) return fail(dbErrorMessage(error));
      report.availability = data?.length ?? 0;
    }
  }

  // 6. 金額（オーナーだけが読み書きできる表）: 請求の人日単価・交通費別・日ごとの日当
  const rates = plan.events.filter((e) => e.rate != null).map((e) => ({ event_id: eventId.get(e.key)!, kind: "per_person_day" as const, role_id: roleId, amount: e.rate! }));
  if (rates.length) {
    const { error } = await supabase.from("event_rates").upsert(rates, { onConflict: "event_id,kind,role_id,item_id" });
    if (error) return fail(dbErrorMessage(error));
    report.rates = rates.length;
  }
  if (plan.transportClients.length) {
    const { error } = await supabase
      .from("company_billing")
      .upsert(plan.transportClients.map((c) => ({ company_id: idOf("client", c), bill_transport: true })), { onConflict: "company_id" });
    if (error) return fail(dbErrorMessage(error));
  }
  const daily = plan.assignments.filter((a) => a.dailyRate != null);
  if (daily.length) {
    const ids = [...new Set(daily.map((a) => eventId.get(a.eventKey)!))];
    const { data: asg, error } = await supabase.from("assignments").select("id, event_id, staff_id").in("event_id", ids);
    if (error) return fail(dbErrorMessage(error));
    const byKey = new Map((asg ?? []).map((a) => [`${a.event_id}|${a.staff_id}`, a.id]));
    const rows = daily
      .map((a) => ({ assignment_id: byKey.get(`${eventId.get(a.eventKey)}|${a.staffId}`), daily_rate_override: a.dailyRate! }))
      .filter((r): r is { assignment_id: string; daily_rate_override: number } => Boolean(r.assignment_id));
    if (rows.length) {
      const { error: e2 } = await supabase.from("assignment_private").upsert(rows, { onConflict: "assignment_id" });
      if (e2) return fail(dbErrorMessage(e2));
      report.dailyRates = rows.length;
    }
  }

  return ok("取り込みました", report);
}
