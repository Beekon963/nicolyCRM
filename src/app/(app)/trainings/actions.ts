"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertMember, assertOwner } from "@/lib/auth";
import { isDateString, jstToInstant } from "@/lib/date";
import { addBookingToCalendar, checkCalendar, removeBookingFromCalendar } from "@/lib/data/trainings";
import { createClient } from "@/lib/supabase/server";

const PATH = "/trainings";
const url = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || /^https?:\/\/\S+$/.test(v), "URL は https:// から始まる形で入れてください");

/** 予約用リンクを作る・作り直す（作り直すと古いリンクはすぐ使えなくなる。オーナーのみ） */
export async function issueTrainingLink(): Promise<ActionResult> {
  await assertOwner();
  const supabase = await createClient();
  const { error } = await supabase
    .from("share_links")
    .upsert({ kind: "training", token: randomBytes(32).toString("base64url"), is_active: true, rotated_at: new Date().toISOString() }, { onConflict: "kind" });
  if (error) return fail(dbErrorMessage(error));
  revalidatePath(PATH);
  return ok("予約用リンクを作りました");
}

/** 予約用リンクを止める・再開する（オーナーのみ） */
export async function setTrainingLinkActive(active: boolean): Promise<ActionResult> {
  await assertOwner();
  const supabase = await createClient();
  const { error, count } = await supabase.from("share_links").update({ is_active: active }, { count: "exact" }).eq("kind", "training");
  if (error) return fail(dbErrorMessage(error));
  if (!count) return fail("まだリンクを作っていません");
  revalidatePath(PATH);
  return ok(active ? "予約用リンクを再開しました" : "予約用リンクを止めました");
}

const slotsInput = z.object({
  dates: z.array(z.string().refine(isDateString)).min(1, "日付を選んでください").max(31, "日付は31日分までです"),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "始まる時刻を選んでください"),
  minutes: z.number().int().min(15).max(480),
  count: z.number().int().min(1).max(12),
  capacity: z.number().int().min(1).max(100),
  title: z.string().trim().min(1, "研修の名前を入れてください").max(50),
  meetingUrl: url,
  note: z.string().trim().max(500),
});
export type SlotsInput = z.infer<typeof slotsInput>;

/** 研修の枠をまとめて作る（選んだ日ごとに、始まる時刻から「長さ × 数」だけ続けて作る） */
export async function createTrainingSlots(input: SlotsInput): Promise<ActionResult> {
  await assertMember();
  const p = slotsInput.safeParse(input);
  if (!p.success) return fail(p.error.issues[0].message);
  const v = p.data;
  const now = Date.now();
  const rows = v.dates.flatMap((d) =>
    Array.from({ length: v.count }, (_, i) => {
      const start = new Date(jstToInstant(d, v.start).getTime() + i * v.minutes * 60_000);
      return { start, end: new Date(start.getTime() + v.minutes * 60_000) };
    }),
  );
  const future = rows.filter((r) => r.start.getTime() > now);
  if (!future.length) return fail("過ぎた日時の枠は作れません");
  const supabase = await createClient();
  const { error } = await supabase.from("training_slots").insert(
    future.map((r) => ({
      title: v.title,
      starts_at: r.start.toISOString(),
      ends_at: r.end.toISOString(),
      capacity: v.capacity,
      meeting_url: v.meetingUrl,
      note: v.note,
    })),
  );
  if (error) return fail(dbErrorMessage(error));
  revalidatePath(PATH);
  const skipped = rows.length - future.length;
  return ok(`${future.length}枠を作りました${skipped ? `（過ぎた ${skipped}枠は作っていません）` : ""}`);
}

const slotEdit = z.object({ title: z.string().trim().min(1, "研修の名前を入れてください").max(50), capacity: z.number().int().min(1).max(100), meetingUrl: url, note: z.string().trim().max(500) });

/** 枠を直す（名前・定員・URL・ご案内。日時を変えるときは止めて作り直す） */
export async function updateTrainingSlot(id: string, input: z.infer<typeof slotEdit>): Promise<ActionResult> {
  await assertMember();
  const p = slotEdit.safeParse(input);
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await createClient();
  const { count } = await supabase.from("training_bookings").select("id", { count: "exact", head: true }).eq("slot_id", id).is("cancelled_at", null);
  if ((count ?? 0) > p.data.capacity) return fail(`すでに ${count}人の予約があるので、定員を ${count} より少なくできません`);
  const { error } = await supabase
    .from("training_slots")
    .update({ title: p.data.title, capacity: p.data.capacity, meeting_url: p.data.meetingUrl, note: p.data.note })
    .eq("id", id);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath(PATH);
  return ok("保存しました");
}

/** 枠を止める（予約の画面に出さない）・再開する。入っている予約はそのまま */
export async function setTrainingSlotActive(id: string, active: boolean): Promise<ActionResult> {
  await assertMember();
  const supabase = await createClient();
  const { error } = await supabase.from("training_slots").update({ is_active: active }).eq("id", id);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath(PATH);
  return ok(active ? "枠を再開しました" : "枠を止めました");
}

const bookingInput = z.object({ name: z.string().trim().min(1, "お名前を入れてください").max(50), contact: z.string().trim().max(100), memo: z.string().trim().max(500) });

async function hasRoom(supabase: Awaited<ReturnType<typeof createClient>>, slotId: string) {
  const [{ data: slot }, { count }] = await Promise.all([
    supabase.from("training_slots").select("capacity").eq("id", slotId).maybeSingle(),
    supabase.from("training_bookings").select("id", { count: "exact", head: true }).eq("slot_id", slotId).is("cancelled_at", null),
  ]);
  return slot != null && (count ?? 0) < slot.capacity;
}

/** 電話などで受けた予約を入れる */
export async function addTrainingBooking(slotId: string, input: z.infer<typeof bookingInput>): Promise<ActionResult> {
  await assertMember();
  const p = bookingInput.safeParse(input);
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await createClient();
  if (!(await hasRoom(supabase, slotId))) return fail("満席です。入れるときは、先に定員を増やしてください");
  const { data, error } = await supabase
    .from("training_bookings")
    .insert({ slot_id: slotId, name: p.data.name, contact: p.data.contact, memo: p.data.memo, source: "admin" })
    .select("id")
    .single();
  if (error) return fail(dbErrorMessage(error));
  await addBookingToCalendar(data.id);
  revalidatePath(PATH);
  return ok("予約を入れました");
}

/** 予約を取り消す（「元に戻す」で戻せる） */
export async function cancelTrainingBooking(id: string): Promise<ActionResult> {
  await assertMember();
  const supabase = await createClient();
  const { error } = await supabase.from("training_bookings").update({ cancelled_at: new Date().toISOString() }).eq("id", id).is("cancelled_at", null);
  if (error) return fail(dbErrorMessage(error));
  await removeBookingFromCalendar(id);
  revalidatePath(PATH);
  return ok("予約を取り消しました");
}

/** 取り消した予約を戻す */
export async function restoreTrainingBooking(id: string): Promise<ActionResult> {
  await assertMember();
  const supabase = await createClient();
  const { data: b } = await supabase.from("training_bookings").select("slot_id").eq("id", id).maybeSingle();
  if (!b) return fail("予約が見つかりません");
  if (!(await hasRoom(supabase, b.slot_id))) return fail("その枠は満席になったので、戻せません");
  const { error } = await supabase.from("training_bookings").update({ cancelled_at: null }).eq("id", id);
  if (error) return fail(dbErrorMessage(error));
  await addBookingToCalendar(id);
  revalidatePath(PATH);
  return ok("予約を戻しました");
}

const settingsInput = z.object({
  calendarId: z.string().trim().max(200),
  defaultTitle: z.string().trim().min(1, "研修の名前を入れてください").max(50),
  defaultUrl: url,
});

/** 研修の設定（Google カレンダーの連携・初めに入れておく名前と URL。オーナーのみ） */
export async function saveTrainingSettings(input: z.infer<typeof settingsInput>): Promise<ActionResult> {
  await assertOwner();
  const p = settingsInput.safeParse(input);
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await createClient();
  const { error } = await supabase.from("settings").upsert({ key: "training", value: p.data });
  if (error) return fail(dbErrorMessage(error));
  revalidatePath(PATH);
  if (!p.data.calendarId) return ok("保存しました（カレンダーとはつないでいません）");
  const check = await checkCalendar();
  return check.ok ? ok("保存しました。カレンダーとつながりました") : fail(`保存しましたが、${check.message}`);
}
