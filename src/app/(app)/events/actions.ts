"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const time = z.string().transform((v) => (v ? v.slice(0, 5) : null)).pipe(z.string().regex(/^\d{2}:\d{2}$/, "時刻の形式が正しくありません").nullable());

const eventSchema = z.object({
  client_id: z.uuid("取引先を選んでください"),
  venue_id: z.uuid("会場を選んでください"),
  start_time: time,
  end_time: time,
  meeting_time: time,
  meeting_place: z.string().trim(),
  belongings: z.string().trim(),
  notes: z.string().trim(),
  requirements: z
    .array(z.object({ role_id: z.uuid(), required_count: z.number().int().min(0).max(50) }))
    .refine((rs) => rs.some((r) => r.required_count > 0), "必要人数を1人以上にしてください"),
});

export type EventInput = z.input<typeof eventSchema>;

const dateSchema = z.iso.date("日付を選んでください");

async function insertEvents(input: EventInput, dates: string[], groupName?: string) {
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { requirements, ...values } = parsed.data;
  const supabase = await createClient();

  let group_id: string | null = null;
  if (groupName !== undefined) {
    const { data: g, error } = await supabase.from("event_groups").insert({ name: groupName }).select("id").single();
    if (error || !g) return fail(dbErrorMessage(error));
    group_id = g.id;
  }
  const { data: events, error } = await supabase
    .from("events")
    .insert(dates.map((date) => ({ ...values, date, group_id })))
    .select("id");
  if (error || !events) return fail(dbErrorMessage(error));
  const reqRows = events.flatMap((e) => requirements.filter((r) => r.required_count > 0).map((r) => ({ event_id: e.id, ...r })));
  const { error: reqError } = await supabase.from("event_requirements").insert(reqRows);
  if (reqError) return fail(dbErrorMessage(reqError));
  revalidatePath("/events", "layout");
  revalidatePath("/");
  return ok<{ ids: string[]; groupId: string | null }>(undefined, { ids: events.map((e) => e.id), groupId: group_id });
}

export async function createEvent(input: EventInput, date: string): Promise<ActionResult<{ ids: string[]; groupId: string | null }>> {
  await assertMember();
  const d = dateSchema.safeParse(date);
  if (!d.success) return fail(d.error.issues[0].message);
  const r = await insertEvents(input, [d.data]);
  return r.ok ? { ...r, message: "現場を作りました" } : r;
}

/** 期間＋曜日でまとめて作る（要件 §4.2）。同じグループとして紐付ける */
export async function createEventsBulk(
  input: EventInput,
  dates: string[],
  groupName: string,
): Promise<ActionResult<{ ids: string[]; groupId: string | null }>> {
  await assertMember();
  const d = z.array(dateSchema).min(1, "作成する日がありません").max(92, "一度に作れるのは92日分までです").safeParse(dates);
  if (!d.success) return fail(d.error.issues[0].message);
  const r = await insertEvents(input, [...new Set(d.data)].sort(), groupName.trim() || "まとめて作成");
  return r.ok ? { ...r, message: `${d.data.length}件の現場を作りました` } : r;
}

export async function updateEvent(id: string, input: EventInput, date: string): Promise<ActionResult> {
  await assertMember();
  const parsed = eventSchema.safeParse(input);
  const d = dateSchema.safeParse(date);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  if (!d.success) return fail(d.error.issues[0].message);
  const { requirements, ...values } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("events").update({ ...values, date: d.data }).eq("id", id);
  if (error) return fail(dbErrorMessage(error));
  // 必要人数は付け直す（0人の役割は行を消す）
  const { error: delError } = await supabase.from("event_requirements").delete().eq("event_id", id);
  if (delError) return fail(dbErrorMessage(delError));
  const rows = requirements.filter((r) => r.required_count > 0).map((r) => ({ event_id: id, ...r }));
  if (rows.length) {
    const { error: insError } = await supabase.from("event_requirements").insert(rows);
    if (insError) return fail(dbErrorMessage(insError));
  }
  revalidatePath("/events", "layout");
  revalidatePath("/");
  return ok("保存しました");
}

/** 別の日に複製（アサインはコピーしない） */
export async function duplicateEvent(id: string, dates: string[]): Promise<ActionResult<{ ids: string[] }>> {
  await assertMember();
  const d = z.array(dateSchema).min(1, "複製先の日付を選んでください").max(31).safeParse(dates);
  if (!d.success) return fail(d.error.issues[0].message);
  const supabase = await createClient();
  const [{ data: ev }, { data: reqs }] = await Promise.all([
    supabase.from("events").select("client_id, venue_id, start_time, end_time, meeting_time, meeting_place, belongings, notes, group_id").eq("id", id).single(),
    supabase.from("event_requirements").select("role_id, required_count").eq("event_id", id),
  ]);
  if (!ev) return fail("複製元の現場が見つかりません");
  const { data: created, error } = await supabase
    .from("events")
    .insert(d.data.map((date) => ({ ...ev, date })))
    .select("id");
  if (error || !created) return fail(dbErrorMessage(error));
  const rows = created.flatMap((e) => (reqs ?? []).map((r) => ({ event_id: e.id, ...r })));
  if (rows.length) await supabase.from("event_requirements").insert(rows);
  revalidatePath("/events", "layout");
  return ok(`${created.length}件 複製しました`, { ids: created.map((e) => e.id) });
}

export async function setEventCancelled(id: string, cancelled: boolean, reason = ""): Promise<ActionResult> {
  await assertMember();
  const supabase = await createClient();
  const { error } = await supabase
    .from("events")
    .update({ cancelled_at: cancelled ? new Date().toISOString() : null, cancel_reason: cancelled ? reason.trim() : "" })
    .eq("id", id);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/events", "layout");
  revalidatePath("/");
  return ok(cancelled ? "中止にしました" : "中止を取り消しました");
}

// ---------------------------------------------------------------------------
// アサイン
// ---------------------------------------------------------------------------

/** 候補から選んだ人に一括で打診する（状態は「打診中」） */
export async function offerStaff(eventId: string, roleId: string, staffIds: string[]): Promise<ActionResult<{ ids: string[] }>> {
  await assertMember();
  const parsed = z.object({ eventId: z.uuid(), roleId: z.uuid(), staffIds: z.array(z.uuid()).min(1, "打診する人を選んでください") }).safeParse({ eventId, roleId, staffIds });
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assignments")
    .insert(parsed.data.staffIds.map((staff_id) => ({ event_id: eventId, staff_id, role_id: roleId, status: "offered" as const })))
    .select("id");
  if (error || !data) return fail(error?.code === "23505" ? "すでにこの現場に入っている人が含まれています" : dbErrorMessage(error));
  revalidatePath(`/events/${eventId}`, "layout");
  revalidatePath("/");
  return ok(`${data.length}人に打診しました`, { ids: data.map((a) => a.id) });
}

const STATUSES = ["offered", "confirmed", "waitlisted", "declined", "cancelled", "no_show"] as const;
type Status = (typeof STATUSES)[number];

/**
 * 状態を手動で変える（LINE で口頭回答が来たときなど。要件 §4.3-5）。
 * キャンセル・当日不稼働は理由が必須で、稼働履歴メモに自動で記録される（DB のトリガー）。
 */
export async function setAssignmentStatus(
  id: string,
  status: Status,
  reason?: { code: string; text: string },
): Promise<ActionResult<{ previous: Status }>> {
  await assertMember();
  if (!STATUSES.includes(status)) return fail("不正な状態です");
  if ((status === "cancelled" || status === "no_show") && !reason?.code) return fail("理由を選んでください");
  const supabase = await createClient();
  const { data: before } = await supabase.from("assignments").select("status, event_id, responded_at").eq("id", id).single();
  if (!before) return fail("アサインが見つかりません");
  const { error } = await supabase
    .from("assignments")
    .update({
      status,
      responded_at: status === "offered" ? null : (before.responded_at ?? new Date().toISOString()),
      response_source: status === "offered" ? null : "admin",
      cancel_reason_code: reason?.code ?? null,
      cancel_reason: reason?.text?.trim() ?? "",
    })
    .eq("id", id);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath(`/events/${before.event_id}`, "layout");
  revalidatePath("/");
  return ok(undefined, { previous: before.status });
}

/** 打診の取り消し（回答前だけ。元に戻す用） */
export async function removeOffer(id: string): Promise<ActionResult> {
  await assertMember();
  const supabase = await createClient();
  const { data: a } = await supabase.from("assignments").select("event_id").eq("id", id).single();
  const { error, count } = await supabase.from("assignments").delete({ count: "exact" }).eq("id", id);
  if (error) return fail(dbErrorMessage(error));
  if (!count) return fail("回答済みの打診は取り消せません。状態を「辞退」などに変えてください。");
  if (a) revalidatePath(`/events/${a.event_id}`, "layout");
  revalidatePath("/");
  return ok("打診を取り消しました");
}

/** 確定連絡・前日リマインドを送ったチェック（送ったら付け、未送信はホームに出す） */
export async function markSent(ids: string[], kind: "confirm" | "reminder", sent = true): Promise<ActionResult> {
  await assertMember();
  const supabase = await createClient();
  const at = sent ? new Date().toISOString() : null;
  const { data, error } = await supabase
    .from("assignments")
    .update(kind === "confirm" ? { confirm_notice_sent_at: at } : { reminder_sent_at: at })
    .in("id", ids)
    .select("event_id");
  if (error) return fail(dbErrorMessage(error));
  for (const e of new Set((data ?? []).map((d) => d.event_id))) revalidatePath(`/events/${e}`);
  revalidatePath("/");
  return ok(sent ? "送信済みにしました" : "未送信に戻しました");
}
