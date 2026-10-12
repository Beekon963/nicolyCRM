import "server-only";
import { getMasters } from "@/lib/data/masters";
import type { NameDict } from "@/lib/report-convert";
import { createClient } from "@/lib/supabase/server";

export type AliasRow = { id: string; companyId: string | null; alias: string; itemId: string; name: string };

/** 言いかえ表（全部）。読むのはメンバー（RLS） */
export async function loadAliases(): Promise<AliasRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("item_aliases").select("id, company_id, alias, item_id, item:items(name)").order("alias");
  return (data ?? []).map((a) => ({ id: a.id, companyId: a.company_id, alias: a.alias, itemId: a.item_id, name: a.item?.name ?? "" }));
}

/** 取引先で使う獲得項目の名前（取引先で選んでいなければ、使っている全項目） */
export async function loadClientItemNames(clientId: string): Promise<string[]> {
  const supabase = await createClient();
  const [masters, { data: chosen }] = await Promise.all([getMasters(), supabase.from("company_items").select("item_id").eq("company_id", clientId)]);
  const ids = new Set((chosen ?? []).map((c) => c.item_id));
  return masters.items.filter((i) => (ids.size ? ids.has(i.id) : i.is_active)).map((i) => i.name);
}

/** 取引先ごとの「名前の辞書」（LINE の報告を公認名称に直すとき・日報を作るときに使う） */
export function dictFor(clientId: string, itemNames: string[], aliases: AliasRow[]): NameDict {
  return {
    items: itemNames,
    // 取引先の分を先に（同じ書き方なら取引先の分が勝つ）
    aliases: aliases
      .filter((a) => a.companyId === clientId || a.companyId == null)
      .sort((a, b) => Number(a.companyId == null) - Number(b.companyId == null))
      .map((a) => ({ alias: a.alias, name: a.name })),
  };
}
