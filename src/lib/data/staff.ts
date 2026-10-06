import "server-only";
import { createClient } from "@/lib/supabase/server";
import { matchesQuery } from "@/lib/search";
import type { Masters } from "./masters";

export type StaffListItem = {
  id: string;
  name: string;
  kana: string;
  phone: string;
  nearest_station: string;
  status: "active" | "paused" | "ended";
  rank_id: string | null;
  role_ids: string[];
  area_ids: string[];
};

export type StaffFilters = { q?: string; role?: string; rank?: string; area?: string; status?: string };

export async function listStaff(filters: StaffFilters, masters: Masters): Promise<StaffListItem[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("staff")
    .select("id, name, kana, phone, nearest_station, status, rank_id, staff_roles(role_id), staff_areas(area_id)");
  const rows: StaffListItem[] = (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    kana: s.kana,
    phone: s.phone,
    nearest_station: s.nearest_station,
    status: s.status,
    rank_id: s.rank_id,
    role_ids: s.staff_roles.map((r) => r.role_id),
    area_ids: s.staff_areas.map((a) => a.area_id),
  }));

  const status = filters.status ?? "active";
  const statusOrder = { active: 0, paused: 1, ended: 2 } as const;
  return rows
    .filter((s) => status === "all" || s.status === status)
    .filter((s) => !filters.role || s.role_ids.includes(filters.role))
    .filter((s) => !filters.rank || s.rank_id === filters.rank)
    .filter((s) => !filters.area || s.area_ids.includes(filters.area))
    .filter((s) => !filters.q || matchesQuery(filters.q, { text: [s.name, s.kana], phone: [s.phone] }))
    .sort(
      (a, b) =>
        statusOrder[a.status] - statusOrder[b.status] ||
        (masters.rankById.get(a.rank_id ?? "")?.sort_order ?? 99) - (masters.rankById.get(b.rank_id ?? "")?.sort_order ?? 99) ||
        a.kana.localeCompare(b.kana, "ja"),
    );
}

export async function getStaffDetail(id: string) {
  const supabase = await createClient();
  const { data: staff } = await supabase
    .from("staff")
    .select("*, staff_roles(role_id), staff_areas(area_id)")
    .eq("id", id)
    .maybeSingle();
  if (!staff) return null;

  const [assignments, ng, notes, availability, submissions] = await Promise.all([
    supabase
      .from("assignments")
      .select(
        "id, status, role_id, event:events!inner(id, date, start_time, end_time, cancelled_at, venue:venues(id, name), client:companies(id, name)), report:reports(submitted_at, confirmed_at), report_items(reported_count, confirmed_count)",
      )
      .eq("staff_id", id),
    supabase.from("staff_ng").select("id, reason, venue:venues(id, name), company:companies(id, name)").eq("staff_id", id),
    supabase.from("staff_notes").select("id, date, kind, memo, is_auto").eq("staff_id", id).order("date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("availability").select("date, status").eq("staff_id", id),
    supabase.from("availability_submissions").select("month, memo, submitted_at, source").eq("staff_id", id),
  ]);

  const rows = (assignments.data ?? []).map((a) => {
    const sum = (k: "reported_count" | "confirmed_count") =>
      a.report_items.some((i) => i[k] != null) ? a.report_items.reduce((s, i) => s + (i[k] ?? 0), 0) : null;
    return { ...a, reported_total: sum("reported_count"), confirmed_total: sum("confirmed_count") };
  });
  rows.sort((a, b) => a.event.date.localeCompare(b.event.date));

  return {
    staff,
    assignments: rows,
    ng: ng.data ?? [],
    notes: notes.data ?? [],
    availability: Object.fromEntries((availability.data ?? []).map((a) => [a.date, a.status])) as Record<string, "ok" | "maybe" | "ng">,
    submissions: submissions.data ?? [],
  };
}

export type StaffDetail = NonNullable<Awaited<ReturnType<typeof getStaffDetail>>>;
