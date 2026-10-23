"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { offerStaff, setAssignmentStatus } from "@/app/(app)/events/actions";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertMember, assertOwner } from "@/lib/auth";
import { isPassed, type Stage, STAGES } from "@/lib/jobs/stages";
import { enqueueNewEvents } from "@/lib/line/notify";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/**
 * 案件（Phase 21）の登録・変更。ログイン中の人の権限で行う。
 * - 案件と現場をまとめて作る。単価はオーナーだけが入れ、案件の単価（event_group_private）と現場の請求単価（event_rates）に入れる
 * - 案件 × スタッフ の段階を進める。合格 → その案件の打診を確定（確定連絡・シートの書き戻しは今までの仕組みで動く）、不合格・辞退 → 打診を辞退に
 */

const time = z
  .string()
  .trim()
  .transform((v) => (v ? v.slice(0, 5) : null))
  .pipe(z.string().regex(/^\d{2}:\d{2}$/, "時刻の形式が正しくありません").nullable());

const jobLine = z.object({
  date: z.iso.date(),
  venueId: z.uuid().nullable(),
  /** 会場がまだないときに、この名前で作る */
  newVenueName: z.string().trim().max(100).default(""),
  count: z.number().int().min(1).max(50),
});

const createSchema = z.object({
  clientId: z.uuid("取引先を選んでください"),
  name: z.string().trim().min(1, "案件の名前を入れてください").max(100),
  receivedOn: z.iso.date().nullable().default(null),
  startTime: time,
  endTime: time,
  hoursNote: z.string().trim().max(200).default(""),
  notes: z.string().trim().max(2000).default(""),
  contactName: z.string().trim().max(50).default(""),
  sourceText: z.string().max(20_000).default(""),
  roleId: z.uuid("役割を選んでください"),
  lines: z.array(jobLine).min(1, "日程を1つ以上入れてください").max(120),
  /** オーナーだけ（管理者から来ても使わない） */
  rate: z.number().int().min(0).max(10_000_000).nullable().default(null),
  transportIncluded: z.boolean().default(false),
});
export type CreateJobInput = z.input<typeof createSchema>;

/** 金額（円・¥）の入った行を外す（管理者も読む欄に金額を入れないため） */
const stripMoneyLines = (text: string) =>
  text
    .split("\n")
    .filter((l) => !/円|¥|￥/.test(l))
    .join("\n")
    .trim();

/** 案件と現場をまとめて作る（オーナー・管理者。単価はオーナーのときだけ入れる） */
export async function createJob(input: CreateJobInput): Promise<ActionResult<{ id: string }>> {
  const me = await assertMember();
  const p = createSchema.safeParse(input);
  if (!p.success) return fail(p.error.issues[0].message);
  // 備考に金額（円）の行があっても入れない（管理者も読む欄のため）
  const v = { ...p.data, notes: stripMoneyLines(p.data.notes), hoursNote: stripMoneyLines(p.data.hoursNote) };
  const supabase = await createClient();
  const { data: client } = await supabase.from("companies").select("id, kind").eq("id", v.clientId).maybeSingle();
  if (!client || client.kind !== "client") return fail("取引先を選び直してください");

  // 会場がないものは、この名前で作る（同じ名前は1つ）
  const venueIdByName = new Map<string, string>();
  for (const l of v.lines) {
    if (l.venueId || !l.newVenueName || venueIdByName.has(l.newVenueName)) continue;
    const { data: existing } = await supabase.from("venues").select("id").eq("name", l.newVenueName).maybeSingle();
    if (existing) {
      venueIdByName.set(l.newVenueName, existing.id);
      continue;
    }
    const { data: created, error } = await supabase.from("venues").insert({ name: l.newVenueName }).select("id").single();
    if (error || !created) return fail(dbErrorMessage(error));
    venueIdByName.set(l.newVenueName, created.id);
  }
  const lines = v.lines.map((l) => ({ ...l, venueId: l.venueId ?? venueIdByName.get(l.newVenueName) ?? null }));
  if (lines.some((l) => !l.venueId)) return fail("会場を選んでください（ない会場は「この名前で作る」）");

  const { data: group, error: gErr } = await supabase
    .from("event_groups")
    .insert({ name: v.name, client_id: v.clientId, received_on: v.receivedOn, start_time: v.startTime, end_time: v.endTime, hours_note: v.hoursNote, notes: v.notes, contact_name: v.contactName, source_text: v.sourceText })
    .select("id")
    .single();
  if (gErr || !group) return fail(dbErrorMessage(gErr));

  // 同じ日・同じ会場は1つの現場（人数は大きいほう）
  const byKey = new Map<string, (typeof lines)[number]>();
  for (const l of lines) {
    const k = `${l.date}|${l.venueId}`;
    const cur = byKey.get(k);
    if (!cur || cur.count < l.count) byKey.set(k, l);
  }
  const rows = [...byKey.values()].map((l) => ({ client_id: v.clientId, venue_id: l.venueId!, date: l.date, start_time: v.startTime, end_time: v.endTime, group_id: group.id, notes: v.notes }));
  const { data: events, error: eErr } = await supabase.from("events").insert(rows).select("id, date, venue_id");
  if (eErr || !events) return fail(dbErrorMessage(eErr));
  const countOf = new Map([...byKey.values()].map((l) => [`${l.date}|${l.venueId}`, l.count]));
  const { error: rErr } = await supabase.from("event_requirements").insert(events.map((e) => ({ event_id: e.id, role_id: v.roleId, required_count: countOf.get(`${e.date}|${e.venue_id}`) ?? 1 })));
  if (rErr) return fail(dbErrorMessage(rErr));

  // 単価（オーナーだけ）: 案件の単価と、現場の請求単価（人日）
  if (me.role === "owner" && v.rate != null) {
    const { error: pErr } = await supabase.from("event_group_private").insert({ group_id: group.id, rate: v.rate, transport_included: v.transportIncluded });
    if (pErr) return fail(dbErrorMessage(pErr));
    const { error: rateErr } = await supabase.from("event_rates").insert(events.map((e) => ({ event_id: e.id, kind: "per_person_day" as const, role_id: v.roleId, amount: v.rate! })));
    if (rateErr) return fail(dbErrorMessage(rateErr));
  }
  await enqueueNewEvents(
    events.map((e) => e.id),
    me.id,
  );
  revalidatePath("/jobs", "layout");
  revalidatePath("/events", "layout");
  revalidatePath("/");
  return ok(`案件を作りました（現場 ${events.length}件）`, { id: group.id });
}

const updateSchema = z.object({
  name: z.string().trim().min(1, "案件の名前を入れてください").max(100),
  receivedOn: z.iso.date().nullable().default(null),
  hoursNote: z.string().trim().max(200).default(""),
  notes: z.string().trim().max(2000).default(""),
  contactName: z.string().trim().max(50).default(""),
});

/** 案件の名前・条件を直す */
export async function updateJob(id: string, input: z.input<typeof updateSchema>): Promise<ActionResult> {
  await assertMember();
  if (!z.uuid().safeParse(id).success) return fail("案件が見つかりません");
  const p = updateSchema.safeParse(input);
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await createClient();
  const { error } = await supabase.from("event_groups").update({ name: p.data.name, received_on: p.data.receivedOn, hours_note: stripMoneyLines(p.data.hoursNote), notes: stripMoneyLines(p.data.notes), contact_name: p.data.contactName }).eq("id", id);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/jobs", "layout");
  return ok("直しました");
}

/** 案件の単価（オーナーだけ）。現場の請求単価は変えない（現場の画面で直す） */
export async function setJobRate(id: string, rate: number | null, transportIncluded: boolean): Promise<ActionResult> {
  await assertOwner();
  if (!z.uuid().safeParse(id).success) return fail("案件が見つかりません");
  if (rate != null && (!Number.isInteger(rate) || rate < 0 || rate > 10_000_000)) return fail("単価は 0〜10,000,000 円で入れてください");
  const supabase = await createClient();
  const { error } = await supabase.from("event_group_private").upsert({ group_id: id, rate, transport_included: transportIncluded });
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/jobs", "layout");
  return ok("単価を保存しました");
}

/** 終わった案件にする／戻す */
export async function setJobClosed(id: string, closed: boolean): Promise<ActionResult> {
  await assertMember();
  if (!z.uuid().safeParse(id).success) return fail("案件が見つかりません");
  const supabase = await createClient();
  const { error } = await supabase.from("event_groups").update({ closed_at: closed ? new Date().toISOString() : null }).eq("id", id);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/jobs", "layout");
  revalidatePath("/");
  return ok(closed ? "終わった案件にしました" : "進行中に戻しました");
}

/** 候補を足す（段階は「候補」。すでにいる人は飛ばす） */
export async function addCandidates(groupId: string, staffIds: string[]): Promise<ActionResult<{ added: number }>> {
  await assertMember();
  const p = z.object({ groupId: z.uuid(), staffIds: z.array(z.uuid()).min(1, "スタッフを選んでください").max(50) }).safeParse({ groupId, staffIds });
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await createClient();
  const { data: cur } = await supabase.from("group_candidates").select("staff_id").eq("group_id", groupId);
  const have = new Set((cur ?? []).map((c) => c.staff_id));
  const rows = [...new Set(p.data.staffIds)].filter((id) => !have.has(id)).map((staff_id) => ({ group_id: groupId, staff_id }));
  if (!rows.length) return fail("みんなもう候補に入っています");
  const { error } = await supabase.from("group_candidates").insert(rows);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/jobs", "layout");
  revalidatePath("/");
  return ok(`${rows.length}人を候補に足しました`, { added: rows.length });
}

const stageExtra = z.object({
  interviewSlots: z.string().trim().max(1000).optional(),
  interviewAt: z.string().datetime({ offset: true }).nullable().optional(),
  interviewNote: z.string().trim().max(1000).optional(),
  resultNote: z.string().trim().max(500).optional(),
});
export type StageExtra = z.input<typeof stageExtra>;

/**
 * 段階を変える。合格 → この案件の現場に打診中・補欠で入っている分を確定にする。不合格・辞退 → 辞退にする。
 * 「元に戻す」は前の段階に戻すだけ（確定した予定はそのまま）
 */
export async function setCandidateStage(candidateId: string, stage: Stage, extra: StageExtra = {}): Promise<ActionResult<{ previous: Stage; confirmed: number; declined: number }>> {
  await assertMember();
  if (!z.uuid().safeParse(candidateId).success) return fail("候補が見つかりません");
  if (!STAGES.includes(stage)) return fail("不正な段階です");
  const ex = stageExtra.safeParse(extra);
  if (!ex.success) return fail("入力の形が正しくありません");
  const supabase = await createClient();
  const { data: cand } = await supabase.from("group_candidates").select("id, group_id, staff_id, stage").eq("id", candidateId).maybeSingle();
  if (!cand) return fail("候補が見つかりません");
  const previous = cand.stage as Stage;
  const patch: Database["public"]["Tables"]["group_candidates"]["Update"] = { stage };
  if (ex.data.interviewSlots !== undefined) patch.interview_slots = ex.data.interviewSlots;
  if (ex.data.interviewAt !== undefined) patch.interview_at = ex.data.interviewAt;
  if (ex.data.interviewNote !== undefined) patch.interview_note = ex.data.interviewNote;
  if (ex.data.resultNote !== undefined) patch.result_note = ex.data.resultNote;
  const { error } = await supabase.from("group_candidates").update(patch).eq("id", candidateId);
  if (error) return fail(dbErrorMessage(error));

  // この案件の現場で、その人の打診中・補欠 → 合格なら確定、不合格・辞退なら辞退
  let confirmed = 0;
  let declined = 0;
  const becamePassed = isPassed(stage) && !isPassed(previous);
  const becameOut = (stage === "failed" || stage === "withdrawn") && previous !== "failed" && previous !== "withdrawn";
  if (becamePassed || becameOut) {
    const { data: asgs } = await supabase
      .from("assignments")
      .select("id, status, event:events!inner(group_id, cancelled_at)")
      .eq("staff_id", cand.staff_id)
      .eq("event.group_id", cand.group_id)
      .is("event.cancelled_at", null)
      .in("status", ["offered", "waitlisted"]);
    for (const a of asgs ?? []) {
      const r = await setAssignmentStatus(a.id, becamePassed ? "confirmed" : "declined");
      if (!r.ok) continue;
      if (becamePassed) confirmed++;
      else declined++;
    }
  }
  revalidatePath("/jobs", "layout");
  revalidatePath("/events", "layout");
  revalidatePath("/");
  return ok(undefined, { previous, confirmed, declined });
}

/** 候補から外す（まだ「候補」なら消す。進んでいれば「辞退・取り下げ」にする） */
export async function removeCandidate(candidateId: string): Promise<ActionResult> {
  await assertMember();
  if (!z.uuid().safeParse(candidateId).success) return fail("候補が見つかりません");
  const supabase = await createClient();
  const { data: cand } = await supabase.from("group_candidates").select("id, stage").eq("id", candidateId).maybeSingle();
  if (!cand) return fail("候補が見つかりません");
  if (cand.stage === "candidate") {
    const { error } = await supabase.from("group_candidates").delete().eq("id", candidateId);
    if (error) return fail(dbErrorMessage(error));
    revalidatePath("/jobs", "layout");
    return ok("候補から外しました");
  }
  const r = await setCandidateStage(candidateId, "withdrawn");
  return r.ok ? ok("辞退・取り下げにしました") : r;
}

/** 候補の人を、この案件の現場（選んだ日）に打診する（状態は「打診中」。合格で確定になる） */
export async function offerCandidate(candidateId: string, eventIds: string[], roleId: string): Promise<ActionResult<{ offered: number }>> {
  await assertMember();
  const p = z.object({ candidateId: z.uuid(), eventIds: z.array(z.uuid()).min(1, "日程を選んでください").max(120), roleId: z.uuid("役割を選んでください") }).safeParse({ candidateId, eventIds, roleId });
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await createClient();
  const { data: cand } = await supabase.from("group_candidates").select("group_id, staff_id").eq("id", candidateId).maybeSingle();
  if (!cand) return fail("候補が見つかりません");
  const { data: evs } = await supabase.from("events").select("id").eq("group_id", cand.group_id).in("id", p.data.eventIds).is("cancelled_at", null);
  const { data: cur } = await supabase.from("assignments").select("event_id").eq("staff_id", cand.staff_id).in("event_id", (evs ?? []).map((e) => e.id));
  const have = new Set((cur ?? []).map((a) => a.event_id));
  let offered = 0;
  for (const e of evs ?? []) {
    if (have.has(e.id)) continue;
    const r = await offerStaff(e.id, p.data.roleId, [cand.staff_id]);
    if (r.ok) offered++;
  }
  if (!offered) return fail("もうその日程に入っています");
  revalidatePath("/jobs", "layout");
  return ok(`${offered}日分を打診中にしました`, { offered });
}
