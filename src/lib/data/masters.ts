import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type Master = { id: string; name: string; sort_order: number; is_active: boolean };

/** 役割・獲得項目・ランク・エリア（無効化したものも含む。過去データの表示に使う） */
export const getMasters = cache(async () => {
  const supabase = await createClient();
  const [roles, items, ranks, areas] = await Promise.all([
    supabase.from("roles").select("id, name, sort_order, is_active").order("sort_order"),
    supabase.from("items").select("id, name, sort_order, is_active").order("sort_order"),
    supabase.from("ranks").select("id, name, sort_order, is_active").order("sort_order"),
    supabase.from("areas").select("id, name, sort_order, is_active").order("sort_order"),
  ]);
  const list = (r: { data: Master[] | null }) => r.data ?? [];
  const byId = (ms: Master[]) => new Map(ms.map((m) => [m.id, m]));
  return {
    roles: list(roles),
    items: list(items),
    ranks: list(ranks),
    areas: list(areas),
    roleById: byId(list(roles)),
    itemById: byId(list(items)),
    rankById: byId(list(ranks)),
    areaById: byId(list(areas)),
  };
});

export type Masters = Awaited<ReturnType<typeof getMasters>>;
