import "server-only";
import { addDays, todayJst } from "@/lib/date";
import { holidaysBetween } from "@/lib/date/holidays";
import { createClient } from "@/lib/supabase/server";
import { getMasters } from "./masters";

/** 現場の作成・編集画面の選択肢 */
export async function eventFormOptions(keep: { client_id?: string; venue_id?: string } = {}) {
  const supabase = await createClient();
  const [masters, { data: clients }, { data: venues }] = await Promise.all([
    getMasters(),
    supabase.from("companies").select("id, name, is_active").eq("kind", "client").order("name"),
    supabase.from("venues").select("id, name, is_active").order("name"),
  ]);
  const today = todayJst();
  return {
    clients: (clients ?? []).filter((c) => c.is_active || c.id === keep.client_id),
    venues: (venues ?? []).filter((v) => v.is_active || v.id === keep.venue_id),
    roles: masters.roles.filter((r) => r.is_active),
    holidays: holidaysBetween(addDays(today, -60), addDays(today, 400)),
  };
}
