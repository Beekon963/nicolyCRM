import "server-only";
import { createClient } from "@/lib/supabase/server";
import { matchesQuery } from "@/lib/search";

/** 次回アクション日と「次にやること」が必須の状態（取引中・見送り以外。要件 §4.8） */
export function needsNextAction(status: string) {
  return status !== "active" && status !== "dormant";
}

export async function listCompanies(filters: { kind?: string; q?: string; status?: string; inactive?: string }) {
  const supabase = await createClient();
  const kind = filters.kind === "partner" ? "partner" : "client";
  const { data } = await supabase
    .from("companies")
    .select("id, kind, name, kana, phone, status, priority, next_action_date, next_action, is_active, owner:app_users(id, name)")
    .eq("kind", kind);
  return (data ?? [])
    .filter((c) => filters.inactive === "1" || c.is_active)
    .filter((c) => !filters.status || c.status === filters.status)
    .filter((c) => !filters.q || matchesQuery(filters.q, { text: [c.name, c.kana], phone: [c.phone] }))
    .sort((a, b) => (a.next_action_date ?? "9999").localeCompare(b.next_action_date ?? "9999") || a.name.localeCompare(b.name, "ja"));
}

export async function getCompanyDetail(id: string) {
  const supabase = await createClient();
  const { data: company } = await supabase.from("companies").select("*, owner:app_users(id, name)").eq("id", id).maybeSingle();
  if (!company) return null;
  const [contacts, links, items, events] = await Promise.all([
    supabase.from("contacts").select("*").eq("company_id", id).order("is_active", { ascending: false }).order("created_at"),
    supabase.from("company_links").select("*").eq("company_id", id).order("created_at"),
    supabase.from("company_items").select("item_id").eq("company_id", id),
    company.kind === "client"
      ? supabase.from("event_overview").select("id, date, status, required_total, confirmed_total, venue:venues(name)").eq("client_id", id).order("date", { ascending: false }).limit(30)
      : Promise.resolve({ data: [] }),
  ]);
  return {
    company,
    contacts: contacts.data ?? [],
    links: links.data ?? [],
    itemIds: (items.data ?? []).map((i) => i.item_id),
    events: events.data ?? [],
  };
}
