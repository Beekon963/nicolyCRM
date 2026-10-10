"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { removeOffer, setAssignmentStatus } from "../actions";

type LiveStatus = "offered" | "confirmed" | "waitlisted";

function revalidate(eventId?: string) {
  revalidatePath("/events/board");
  if (eventId) revalidatePath(`/events/${eventId}`, "layout");
  revalidatePath("/");
}

/**
 * 稼働表のマスから打診・確定する（1人 × 1現場）。
 * - まだ入っていない → 打診中 または 確定で入れる
 * - 打診中・補欠で入っている → 確定にする
 * 元に戻す用に、前の状態（新しく入れたときは null）を返す。
 */
export async function assignFromBoard(
  eventId: string,
  staffId: string,
  roleId: string,
  status: "offered" | "confirmed",
): Promise<ActionResult<{ id: string; previous: LiveStatus | null }>> {
  await assertMember();
  const parsed = z
    .object({ eventId: z.uuid(), staffId: z.uuid(), roleId: z.uuid(), status: z.enum(["offered", "confirmed"]) })
    .safeParse({ eventId, staffId, roleId, status });
  if (!parsed.success) return fail("入力内容を確認してください");
  const supabase = await createClient();

  const { data: cur } = await supabase.from("assignments").select("id, status").eq("event_id", eventId).eq("staff_id", staffId).maybeSingle();
  if (cur) {
    if (status === "offered") return fail("すでにこの現場に入っています");
    if (cur.status === "confirmed") return fail("すでに確定しています");
    if (!["offered", "waitlisted"].includes(cur.status)) return fail("辞退・キャンセルした人は、現場の画面から状態を変えてください");
    const r = await setAssignmentStatus(cur.id, "confirmed");
    if (!r.ok) return r;
    revalidate(eventId);
    return ok("確定にしました", { id: cur.id, previous: cur.status as LiveStatus });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("assignments")
    .insert({
      event_id: eventId,
      staff_id: staffId,
      role_id: roleId,
      status,
      ...(status === "confirmed" ? { responded_at: now, response_source: "admin" as const } : {}),
    })
    .select("id")
    .single();
  if (error || !data) return fail(dbErrorMessage(error));
  revalidate(eventId);
  return ok(status === "confirmed" ? "確定にしました" : "打診しました", { id: data.id, previous: null });
}

/** assignFromBoard を元に戻す */
export async function undoAssignFromBoard(id: string, previous: LiveStatus | null): Promise<ActionResult> {
  await assertMember();
  if (!z.uuid().safeParse(id).success) return fail("不正な指定です");
  const supabase = await createClient();
  const { data: cur } = await supabase.from("assignments").select("status, event_id").eq("id", id).maybeSingle();
  if (!cur) return fail("見つかりません");
  if (previous) {
    const r = await setAssignmentStatus(id, previous);
    if (!r.ok) return r;
  } else {
    if (cur.status !== "offered") {
      const r = await setAssignmentStatus(id, "offered");
      if (!r.ok) return r;
    }
    const r = await removeOffer(id);
    if (!r.ok) return r;
  }
  revalidate(cur.event_id);
  return ok("元に戻しました");
}

/** 稼働可能日を1日分だけ代理入力する（null で未入力に戻す）。元に戻す用に前の値を返す */
export async function setAvailabilityDay(
  staffId: string,
  date: string,
  status: "ok" | "maybe" | "ng" | null,
): Promise<ActionResult<{ previous: "ok" | "maybe" | "ng" | null }>> {
  const me = await assertMember();
  const parsed = z.object({ staffId: z.uuid(), date: z.iso.date(), status: z.enum(["ok", "maybe", "ng"]).nullable() }).safeParse({ staffId, date, status });
  if (!parsed.success) return fail("入力内容を確認してください");
  const supabase = await createClient();
  const { data: cur } = await supabase.from("availability").select("status").eq("staff_id", staffId).eq("date", date).maybeSingle();
  const { error } = status
    ? await supabase.from("availability").upsert({ staff_id: staffId, date, status, source: "admin", updated_by: me.id, updated_at: new Date().toISOString() })
    : await supabase.from("availability").delete().eq("staff_id", staffId).eq("date", date);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/events/board");
  revalidatePath("/availability", "layout");
  return ok("稼働可能日を入れました", { previous: cur?.status ?? null });
}

const cellsSchema = z
  .array(z.object({ staffId: z.uuid(), date: z.iso.date(), status: z.enum(["ok", "maybe", "ng"]).nullable() }))
  .min(1)
  .max(1000, "一度に変えられるのは1000マスまでです");

/**
 * 稼働表で選んだマスの稼働可能日をまとめて代理入力する（キーで ○△× を入れたとき。null は未入力に戻す）。
 * 元に戻すときは、前の値を入れてもう一度呼ぶ。
 */
export async function setAvailabilityCells(cells: { staffId: string; date: string; status: "ok" | "maybe" | "ng" | null }[]): Promise<ActionResult> {
  const me = await assertMember();
  const parsed = cellsSchema.safeParse(cells);
  if (!parsed.success) return fail(parsed.error.issues[0].message.startsWith("一度に") ? parsed.error.issues[0].message : "入力内容を確認してください");
  const supabase = await createClient();
  const now = new Date().toISOString();
  const upserts = parsed.data
    .filter((c) => c.status)
    .map((c) => ({ staff_id: c.staffId, date: c.date, status: c.status!, source: "admin" as const, updated_by: me.id, updated_at: now }));
  if (upserts.length) {
    const { error } = await supabase.from("availability").upsert(upserts);
    if (error) return fail(dbErrorMessage(error));
  }
  // 未入力に戻すマスはスタッフごとにまとめて消す
  const clears = new Map<string, string[]>();
  for (const c of parsed.data.filter((x) => !x.status)) clears.set(c.staffId, [...(clears.get(c.staffId) ?? []), c.date]);
  for (const [staffId, dates] of clears) {
    const { error } = await supabase.from("availability").delete().eq("staff_id", staffId).in("date", dates);
    if (error) return fail(dbErrorMessage(error));
  }
  revalidatePath("/events/board");
  revalidatePath("/availability", "layout");
  const n = parsed.data.length;
  return ok(upserts.length ? `稼働可能日を${n}マス入れました` : `稼働可能日を${n}マス消しました`);
}
