"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const itemSchema = z.object({
  item_id: z.uuid(),
  confirmed: z.number().int().min(0).max(999),
  reason: z.enum(["cancelled", "rejected", "input_error", "other"]).nullable(),
  note: z.string().trim().max(200),
});

/**
 * 1人分の実績を確定する（要件 §4.7）。
 * - 速報と違う件数は理由が必須（DB の制約でも守る）
 * - 未報告の人は、管理者が代理で入力して確定する（速報＝確定、入力元は管理者）
 * - 確定後の修正もここで行い、変更履歴に残る
 */
export async function confirmResult(assignmentId: string, items: z.input<typeof itemSchema>[]): Promise<ActionResult> {
  const me = await assertMember();
  const parsed = z.array(itemSchema).safeParse(items);
  if (!z.uuid().safeParse(assignmentId).success || !parsed.success) return fail("入力内容を確認してください");
  const supabase = await createClient();
  const [{ data: report }, { data: current }] = await Promise.all([
    supabase.from("reports").select("assignment_id, submitted_at").eq("assignment_id", assignmentId).maybeSingle(),
    supabase.from("report_items").select("item_id, reported_count").eq("assignment_id", assignmentId),
  ]);
  const reportedMap = new Map((current ?? []).map((r) => [r.item_id, r.reported_count]));
  const proxy = !report?.submitted_at;

  for (const it of parsed.data) {
    const reported = reportedMap.get(it.item_id);
    const differs = !proxy && reported != null && reported !== it.confirmed;
    if (differs && !it.reason) return fail("速報と違う件数には理由を選んでください");
    if (differs && it.reason === "other" && !it.note) return fail("「その他」の理由はメモを書いてください");
  }

  if (proxy) {
    const { error } = await supabase
      .from("reports")
      .upsert({ assignment_id: assignmentId, submitted_at: new Date().toISOString(), source: "admin" });
    if (error) return fail(dbErrorMessage(error));
  }
  const rows = parsed.data.map((it) => {
    const reported = proxy ? it.confirmed : (reportedMap.get(it.item_id) ?? null);
    const differs = reported != null && reported !== it.confirmed;
    return {
      assignment_id: assignmentId,
      item_id: it.item_id,
      reported_count: reported,
      confirmed_count: it.confirmed,
      diff_reason: differs ? it.reason : null,
      diff_note: differs ? it.note : "",
    };
  });
  const { error: itemError } = await supabase.from("report_items").upsert(rows);
  if (itemError) return fail(dbErrorMessage(itemError));
  const { error } = await supabase
    .from("reports")
    .update({ confirmed_at: new Date().toISOString(), confirmed_by: me.id })
    .eq("assignment_id", assignmentId);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/results");
  revalidatePath("/");
  return ok(proxy ? "代理で入力して確定しました" : "確定しました");
}

/** 速報どおりでよい現場をまとめて確定（報告済み・未確定の人だけ） */
export async function confirmEventAsReported(eventId: string): Promise<ActionResult> {
  const me = await assertMember();
  const supabase = await createClient();
  const { data } = await supabase
    .from("assignments")
    .select("id, report:reports!inner(submitted_at, confirmed_at), report_items(item_id, reported_count)")
    .eq("event_id", eventId)
    .eq("status", "confirmed")
    .not("report.submitted_at", "is", null)
    .is("report.confirmed_at", null);
  const targets = data ?? [];
  if (!targets.length) return fail("速報どおり確定できる人がいません");
  for (const a of targets) {
    if (a.report_items.length) {
      const { error } = await supabase.from("report_items").upsert(
        a.report_items.map((i) => ({ assignment_id: a.id, item_id: i.item_id, reported_count: i.reported_count, confirmed_count: i.reported_count ?? 0, diff_reason: null, diff_note: "" })),
      );
      if (error) return fail(dbErrorMessage(error));
    }
    const { error } = await supabase.from("reports").update({ confirmed_at: new Date().toISOString(), confirmed_by: me.id }).eq("assignment_id", a.id);
    if (error) return fail(dbErrorMessage(error));
  }
  revalidatePath("/results");
  revalidatePath("/");
  return ok(`${targets.length}人分を速報どおり確定しました`);
}

/** 実績の修正履歴（誰が・いつ・何から何に。金額なし） */
export async function getReportHistory(assignmentId: string) {
  await assertMember();
  const supabase = await createClient();
  const { data } = await supabase.rpc("report_history", { p_assignment_id: assignmentId });
  return data ?? [];
}
