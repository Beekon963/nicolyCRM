"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** 管理者の代理入力（LINE で聞いた内容を入れる。入力元は「管理者」で記録。要件 §4.6） */
export async function saveAvailabilityAsAdmin(
  staffId: string,
  month: string,
  days: Record<string, "ok" | "maybe" | "ng" | null>,
  memo: string,
  submit: boolean,
): Promise<ActionResult> {
  const me = await assertMember();
  const parsed = z
    .object({ staffId: z.uuid(), month: z.iso.date(), days: z.record(z.iso.date(), z.enum(["ok", "maybe", "ng"]).nullable()) })
    .safeParse({ staffId, month, days });
  if (!parsed.success) return fail("入力内容を確認してください");
  const monthPrefix = month.slice(0, 7);
  const entries = Object.entries(parsed.data.days).filter(([d]) => d.startsWith(monthPrefix));
  const supabase = await createClient();

  const upserts = entries.filter(([, v]) => v).map(([date, status]) => ({ staff_id: staffId, date, status: status!, source: "admin" as const, updated_by: me.id, updated_at: new Date().toISOString() }));
  const deletes = entries.filter(([, v]) => !v).map(([d]) => d);
  if (upserts.length) {
    const { error } = await supabase.from("availability").upsert(upserts);
    if (error) return fail(dbErrorMessage(error));
  }
  if (deletes.length) {
    const { error } = await supabase.from("availability").delete().eq("staff_id", staffId).in("date", deletes);
    if (error) return fail(dbErrorMessage(error));
  }
  const { data: cur } = await supabase.from("availability_submissions").select("submitted_at, source").eq("staff_id", staffId).eq("month", month).maybeSingle();
  const { error } = await supabase.from("availability_submissions").upsert({
    staff_id: staffId,
    month,
    memo: memo.slice(0, 300),
    submitted_at: submit ? new Date().toISOString() : (cur?.submitted_at ?? null),
    source: submit ? "admin" : (cur?.source ?? "admin"),
  });
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/availability", "layout");
  revalidatePath(`/staff/${staffId}`);
  return ok(submit ? "代理で提出しました" : "保存しました");
}
