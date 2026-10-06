"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isMasterKind, type MasterKind, type MasterRow } from "../kinds";

const rowSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "名前が空の行があります"),
  description: z.string().trim().optional(),
  base_daily_rate: z.number().int().min(0, "基準日当は0円以上にしてください").nullable().optional(),
  is_active: z.boolean(),
});

/** 並び順どおりにまとめて保存する（削除はしない。無効化で対応） */
export async function saveMasters(kind: MasterKind, rows: MasterRow[]): Promise<ActionResult> {
  await assertOwner();
  if (!isMasterKind(kind)) return fail("不正な種類です");
  const parsed = z.array(rowSchema).safeParse(rows);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const names = parsed.data.map((r) => r.name);
  if (new Set(names).size !== names.length) return fail("同じ名前が2つあります");

  const supabase = await createClient();
  // 名前の入れ替えで一時的に重複しないよう、既存の行を先に仮の名前にする
  const existing = parsed.data.filter((r) => r.id);
  for (const r of existing) {
    const { error } = await supabase.from(kind as "roles").update({ name: `__tmp__${r.id}` }).eq("id", r.id!);
    if (error) return fail(dbErrorMessage(error));
  }

  for (const [i, r] of parsed.data.entries()) {
    const base = { name: r.name, sort_order: i + 1, is_active: r.is_active };
    if (kind === "ranks") {
      const values = { ...base, description: r.description ?? "" };
      const { data, error } = r.id
        ? await supabase.from("ranks").update(values).eq("id", r.id).select("id").single()
        : await supabase.from("ranks").insert(values).select("id").single();
      if (error || !data) return fail(dbErrorMessage(error));
      const rate = r.base_daily_rate;
      const { error: rateError } =
        rate == null
          ? await supabase.from("rank_rates").delete().eq("rank_id", data.id)
          : await supabase.from("rank_rates").upsert({ rank_id: data.id, base_daily_rate: rate });
      if (rateError) return fail(dbErrorMessage(rateError));
    } else {
      // roles / items / areas は同じ形
      const table = kind as "roles";
      const { error } = r.id
        ? await supabase.from(table).update(base).eq("id", r.id)
        : await supabase.from(table).insert(base);
      if (error) return fail(dbErrorMessage(error));
    }
  }

  revalidatePath(`/settings/masters/${kind}`);
  return ok("保存しました");
}
