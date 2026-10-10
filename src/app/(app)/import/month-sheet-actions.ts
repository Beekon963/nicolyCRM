"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertOwner } from "@/lib/auth";
import { monthRange, todayJst } from "@/lib/date";
import type { ParsedMonthSheet } from "@/lib/import/month-sheet";
import { buildPlan, type PlanChoices, type PlanContext, type Ref } from "@/lib/import/month-sheet-plan";
import { selectAll } from "@/lib/supabase/select-all";
import { createClient } from "@/lib/supabase/server";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "対象の月を選んでください");

const parsedSchema = z.object({
  month: z.number().int().nullable(),
  days: z.array(z.number().int()),
  warnings: z.array(z.string()),
  clients: z
    .array(
      z.object({
        name: z.string().min(1),
        lines: z.array(z.object({ day: z.number().int(), venue: z.string().min(1), required: z.number().int().min(0).max(100), rate: z.number().int().nullable(), transport: z.boolean() })),
      }),
    )
    .max(200),
  staff: z
    .array(
      z.object({
        rank: z.string(),
        name: z.string().min(1),
        station: z.string(),
        places: z.array(z.object({ day: z.number().int(), place: z.string().min(1) })),
        shifts: z.array(z.object({ day: z.number().int(), status: z.enum(["ok", "maybe", "ng"]) })),
        rates: z.array(z.object({ day: z.number().int(), amount: z.number().int().nullable(), raw: z.string() })),
      }),
    )
    .max(500),
});

const choicesSchema = z.object({
  month: monthSchema,
  clients: z.record(z.string(), z.string()),
  venues: z.record(z.string(), z.string()),
  staff: z.record(z.string(), z.string()),
  places: z.record(z.string(), z.string()),
});

async function loadPlanContext(month: string): Promise<PlanContext> {
  const supabase = await createClient();
  const { start, end } = monthRange(month);
  const [clients, venues, staff, events] = await Promise.all([
    selectAll((f, t) => supabase.from("companies").select("id, name").eq("kind", "client").order("id").range(f, t)),
    selectAll((f, t) => supabase.from("venues").select("id, name").order("id").range(f, t)),
    selectAll((f, t) => supabase.from("staff").select("id, name").order("id").range(f, t)),
    selectAll((f, t) => supabase.from("events").select("id, date, client_id, venue_id").gte("date", start).lte("date", end).is("cancelled_at", null).order("id").range(f, t)),
  ]);
  return { today: todayJst(), clients, venues, staff, events };
}

/** 突き合わせに使う取引先・会場・名簿・その月の現場（取り込み画面のプレビュー用） */
export async function getMonthSheetContext(month: string): Promise<ActionResult<PlanContext>> {
  await assertOwner();
  const m = monthSchema.safeParse(month);
  if (!m.success) return fail(m.error.issues[0].message);
  return { ok: true, data: await loadPlanContext(m.data) };
}

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

/**
 * 月のシートを取り込む（オーナーのみ。単価などの金額も入るため）。
 * 同じ月をもう一度取り込んでも重ならない（同じ日・取引先・会場の現場は使い回し、入っている人・提出済みの稼働可能日はそのまま）。
 */
export async function importMonthSheet(parsedInput: ParsedMonthSheet, choicesInput: PlanChoices, roleId: string): Promise<ActionResult<MonthSheetReport>> {
  await assertOwner();
  const parsed = parsedSchema.safeParse(parsedInput);
  const choices = choicesSchema.safeParse(choicesInput);
  if (!parsed.success || !choices.success) return fail("取り込めない形式です。ファイルを選び直してください");
  if (!z.uuid().safeParse(roleId).success) return fail("役割を選んでください");

  const supabase = await createClient();
  const ctx = await loadPlanContext(choices.data.month);
  const plan = buildPlan(parsed.data, ctx, choices.data);
  const report: MonthSheetReport = { clients: 0, venues: 0, eventsCreated: 0, eventsReused: 0, assignments: 0, availability: 0, rates: 0, dailyRates: 0 };

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
    const { data, error } = await supabase.from("assignments").upsert(asgRows, { onConflict: "event_id,staff_id", ignoreDuplicates: true }).select("id");
    if (error) return fail(dbErrorMessage(error));
    report.assignments = data?.length ?? 0;
  }

  // 5. 稼働可能日（本人が出したものは上書きしない）
  if (plan.availability.length) {
    const { data, error } = await supabase
      .from("availability")
      .upsert(
        plan.availability.map((a) => ({ staff_id: a.staffId, date: a.date, status: a.status, source: "admin" as const })),
        { onConflict: "staff_id,date", ignoreDuplicates: true },
      )
      .select("staff_id");
    if (error) return fail(dbErrorMessage(error));
    report.availability = data?.length ?? 0;
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

  revalidatePath("/", "layout");
  return ok("取り込みました", report);
}
