"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const aliasSchema = z.object({
  companyId: z.uuid().nullable(),
  alias: z.string().trim().min(1, "書き方を入れてください").max(100, "書き方は100文字までです"),
  itemName: z.string().trim().min(1, "項目を選んでください"),
});

/**
 * 言いかえ表に足す（オーナーだけ）。同じ取引先で同じ書き方があれば、項目を置きかえる
 */
export async function saveItemAlias(companyId: string | null, alias: string, itemName: string): Promise<ActionResult> {
  try {
    await assertOwner();
  } catch {
    return fail("言いかえ表を変えられるのはオーナーだけです");
  }
  const parsed = aliasSchema.safeParse({ companyId, alias, itemName });
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;
  const supabase = await createClient();
  const { data: item } = await supabase.from("items").select("id").eq("name", v.itemName).maybeSingle();
  if (!item) return fail("その項目が見つかりません");
  let q = supabase.from("item_aliases").select("id, alias");
  q = v.companyId ? q.eq("company_id", v.companyId) : q.is("company_id", null);
  const { data: rows } = await q;
  const same = (rows ?? []).find((r) => r.alias.trim().toLowerCase() === v.alias.toLowerCase());
  const { error } = same
    ? await supabase.from("item_aliases").update({ item_id: item.id, alias: v.alias }).eq("id", same.id)
    : await supabase.from("item_aliases").insert({ company_id: v.companyId, alias: v.alias, item_id: item.id });
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/settings/report-formats");
  return ok(`「${v.alias}」は「${v.itemName}」と覚えました`);
}

/** 言いかえ表から消す（オーナーだけ） */
export async function deleteItemAlias(id: string): Promise<ActionResult> {
  try {
    await assertOwner();
  } catch {
    return fail("言いかえ表を変えられるのはオーナーだけです");
  }
  if (!z.uuid().safeParse(id).success) return fail("不正な指定です");
  const supabase = await createClient();
  const { error } = await supabase.from("item_aliases").delete().eq("id", id);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/settings/report-formats");
  return ok("消しました");
}
