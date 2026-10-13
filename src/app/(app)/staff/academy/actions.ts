"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * NICOLY アカデミーの進み具合を取り込む（Phase 14。オーナー・管理者）。
 * 画面で CSV を読み、選んだスタッフごとに1行ずつ送る（CSV そのものは受け取らない）。
 * - 1人1行（いちばん新しいもの）に置きかえる
 * - 前に別のスタッフに結びついていたアカデミーのログイン（academy_id）は、選び直した人に移す（前の人の記録は外れる）
 */

const count = z.number().int().min(0).max(999);
const fraction = z
  .object({ done: count, total: count })
  .refine((f) => f.done <= f.total)
  .nullable();

const rowSchema = z.object({
  staffId: z.uuid(),
  academyId: z.string().trim().min(1).max(64),
  name: z.string().max(100),
  active: z.boolean(),
  roadmap: fraction,
  title: z.string().max(100),
  areas: z.array(z.object({ name: z.string().min(1).max(40), done: count, total: count, test: z.boolean() })).max(20),
  knowledge: z.string().max(100),
  knowledgeOk: z.boolean(),
  roleplay: z.string().max(100),
  roleplayOk: z.boolean(),
  field: fraction,
  decision: z.enum(["ready", "hold", "none"]),
  hearing: count,
  guide: z.string().max(20),
  lastStudiedAt: z.iso.datetime().nullable(),
});

export type AcademyImportRow = z.input<typeof rowSchema>;

export async function importAcademyProgress(input: AcademyImportRow[]): Promise<ActionResult<{ count: number; moved: number }>> {
  const me = await assertMember();
  const parsed = z.array(rowSchema).min(1).max(500).safeParse(input);
  if (!parsed.success) return fail("取り込む内容が正しくありません。もう一度ファイルを選んでください");
  const rows = parsed.data;
  if (new Set(rows.map((r) => r.staffId)).size !== rows.length) return fail("同じスタッフが2回選ばれています。選び直してください");
  if (new Set(rows.map((r) => r.academyId)).size !== rows.length) return fail("同じアカデミーのログインが2回あります。もう一度ファイルを選んでください");

  const supabase = await createClient();
  const { data: staff, error: staffError } = await supabase.from("staff").select("id").in("id", rows.map((r) => r.staffId));
  if (staffError) return fail(dbErrorMessage(staffError));
  if ((staff ?? []).length !== rows.length) return fail("見つからないスタッフがいます。画面を開き直してください");

  // 別のスタッフに結びついていたログインは、選び直した人に移す
  const target = new Map(rows.map((r) => [r.academyId, r.staffId]));
  const { data: linked, error: linkError } = await supabase.from("academy_progress").select("staff_id, academy_id").in("academy_id", rows.map((r) => r.academyId));
  if (linkError) return fail(dbErrorMessage(linkError));
  const moving = (linked ?? []).filter((l) => target.get(l.academy_id) !== l.staff_id).map((l) => l.staff_id);
  if (moving.length) {
    const { error } = await supabase.from("academy_progress").delete().in("staff_id", moving);
    if (error) return fail(dbErrorMessage(error));
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from("academy_progress").upsert(
    rows.map((r) => ({
      staff_id: r.staffId,
      academy_id: r.academyId,
      academy_name: r.name,
      active: r.active,
      roadmap_done: r.roadmap?.done ?? null,
      roadmap_steps: r.roadmap?.total ?? null,
      title: r.title,
      areas: r.areas,
      knowledge: r.knowledge,
      knowledge_ok: r.knowledgeOk,
      roleplay: r.roleplay,
      roleplay_ok: r.roleplayOk,
      field_done: r.field?.done ?? null,
      field_items: r.field?.total ?? null,
      decision: r.decision,
      hearing_count: r.hearing,
      guide: r.guide,
      last_studied_at: r.lastStudiedAt,
      imported_at: now,
      imported_by: me.id,
    })),
    { onConflict: "staff_id" },
  );
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/staff", "layout");
  revalidatePath("/events", "layout");
  return ok(`${rows.length}人のアカデミーの記録を入れました`, { count: rows.length, moved: moving.length });
}
