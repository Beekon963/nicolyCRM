"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertOwner } from "@/lib/auth";
import { itemLines } from "@/lib/items-bulk";
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

/**
 * 獲得項目をまとめて登録する（オーナーだけ）。
 * - 1行に1つ。もうある名前は作らずにそのまま使う（過去のデータを壊さない）
 * - clientId を渡すと、その取引先の「使う獲得項目」に足す（その取引先の現場では、選んだ項目だけ出る）
 */
export async function bulkAddItems(text: string, clientId: string | null): Promise<ActionResult<{ created: number; existing: number }>> {
  await assertOwner();
  const names = itemLines(text);
  if (!names.length) return fail("項目の名前を1行に1つずつ入れてください");
  if (names.length > 200) return fail("一度に入れられるのは200項目までです");
  if (clientId && !z.uuid().safeParse(clientId).success) return fail("不正な取引先です");

  const supabase = await createClient();
  const { data: items, error: readError } = await supabase.from("items").select("id, name, sort_order");
  if (readError) return fail(dbErrorMessage(readError));
  const byName = new Map((items ?? []).map((i) => [i.name, i.id]));
  let order = Math.max(0, ...(items ?? []).map((i) => i.sort_order));
  const fresh = names.filter((n) => !byName.has(n)).map((name) => ({ name, sort_order: ++order, is_active: true }));
  if (fresh.length) {
    const { data, error } = await supabase.from("items").insert(fresh).select("id, name");
    if (error) return fail(dbErrorMessage(error));
    for (const i of data ?? []) byName.set(i.name, i.id);
  }
  // 無効にしていた項目を使い直すときは、有効に戻す
  const reused = names.filter((n) => !fresh.some((f) => f.name === n)).map((n) => byName.get(n)!);
  if (reused.length) {
    const { error } = await supabase.from("items").update({ is_active: true }).in("id", reused);
    if (error) return fail(dbErrorMessage(error));
  }
  if (clientId) {
    const { error } = await supabase
      .from("company_items")
      .upsert(names.map((n) => ({ company_id: clientId, item_id: byName.get(n)! })), { onConflict: "company_id,item_id", ignoreDuplicates: true });
    if (error) return fail(dbErrorMessage(error));
  }
  revalidatePath("/settings/masters/items");
  return ok(`${fresh.length}項目を作りました${names.length - fresh.length ? `（${names.length - fresh.length}項目はもうありました）` : ""}${clientId ? "。取引先の「使う獲得項目」にも入れました" : ""}`, {
    created: fresh.length,
    existing: names.length - fresh.length,
  });
}
