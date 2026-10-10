import "server-only";
import { todayJst } from "@/lib/date";
import { isNextActionMissing, sortCompanies } from "@/lib/sales";
import { matchesQuery } from "@/lib/search";
import { createClient } from "@/lib/supabase/server";

export { needsNextAction } from "@/lib/sales";

export type CompanyFilters = {
  kind?: string;
  q?: string;
  status?: string;
  priority?: string;
  /** 担当者（"me" / "none" / ユーザーの ID） */
  owner?: string;
  /** 次回アクション（"due" = 今日まで / "missing" = 未設定） */
  next?: string;
  inactive?: string;
};

export const COMPANY_FILTER_KEYS = ["kind", "q", "status", "priority", "owner", "next", "inactive", "view"] as const;

export async function listCompanies(filters: CompanyFilters, me?: string) {
  const supabase = await createClient();
  const kind = filters.kind === "partner" ? "partner" : "client";
  const today = todayJst();
  const { data } = await supabase
    .from("companies")
    .select("id, kind, name, kana, phone, status, priority, next_action_date, next_action, is_active, owner_user_id, owner:app_users(id, name), contacts(id, name, is_active)")
    .eq("kind", kind);
  const owner = filters.owner === "me" ? me : filters.owner;
  const list = (data ?? [])
    .filter((c) => filters.inactive === "1" || c.is_active)
    .filter((c) => !filters.status || c.status === filters.status)
    .filter((c) => !filters.priority || c.priority === filters.priority)
    .filter((c) => !owner || (owner === "none" ? c.owner_user_id == null : c.owner_user_id === owner))
    .filter((c) => filters.next !== "due" || (c.next_action_date != null && c.next_action_date <= today))
    .filter((c) => filters.next !== "missing" || isNextActionMissing(c))
    .filter((c) => !filters.q || matchesQuery(filters.q, { text: [c.name, c.kana], phone: [c.phone] }));
  return sortCompanies(list, today).map(({ contacts, ...c }) => ({
    ...c,
    contacts: contacts.filter((ct) => ct.is_active).map((ct) => ({ id: ct.id, name: ct.name })),
  }));
}

export type CompanyListRow = Awaited<ReturnType<typeof listCompanies>>[number];

/** 担当者の絞り込み・選択に使う利用者 */
export async function listActiveUsers() {
  const supabase = await createClient();
  const { data } = await supabase.from("app_users").select("id, name").eq("is_active", true).order("name");
  return data ?? [];
}

export async function getCompanyDetail(id: string) {
  const supabase = await createClient();
  const { data: company } = await supabase.from("companies").select("*, owner:app_users(id, name)").eq("id", id).maybeSingle();
  if (!company) return null;
  const [contacts, links, items, events, activities] = await Promise.all([
    supabase.from("contacts").select("*").eq("company_id", id).order("is_active", { ascending: false }).order("created_at"),
    supabase.from("company_links").select("*").eq("company_id", id).order("created_at"),
    supabase.from("company_items").select("item_id").eq("company_id", id),
    company.kind === "client"
      ? supabase.from("event_overview").select("id, date, status, required_total, confirmed_total, venue:venues(name)").eq("client_id", id).order("date", { ascending: false }).limit(30)
      : Promise.resolve({ data: [] }),
    supabase
      .from("activities")
      .select("id, kind, result, memo, occurred_at, next_action_date, next_action, status, user:app_users(name), contact:contacts(name)")
      .eq("company_id", id)
      .order("occurred_at", { ascending: false })
      .limit(50),
  ]);
  return {
    company,
    contacts: contacts.data ?? [],
    links: links.data ?? [],
    itemIds: (items.data ?? []).map((i) => i.item_id),
    events: events.data ?? [],
    activities: activities.data ?? [],
  };
}

/** ホームの「今日やること（営業）」: 次回アクション日が今日以前の会社（要件 §4.1-3） */
export async function listDueCompanies() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("companies")
    .select("id, kind, name, status, priority, next_action_date, next_action, owner:app_users(name), contacts(id, name, is_active)")
    .eq("is_active", true)
    .lte("next_action_date", todayJst());
  return sortCompanies(data ?? [], todayJst()).map(({ contacts, ...c }) => ({
    ...c,
    contacts: contacts.filter((ct) => ct.is_active).map((ct) => ({ id: ct.id, name: ct.name })),
  }));
}
