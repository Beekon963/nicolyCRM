import "server-only";
import { createClient } from "@/lib/supabase/server";
import { matchesQuery } from "@/lib/search";

export function mapUrl(v: { address: string; name: string }) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.address || v.name)}`;
}

export async function listVenues(filters: { q?: string; area?: string; inactive?: string }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("venues")
    .select("id, name, kana, address, nearest_station, prefecture, area_id, is_active")
    .order("kana")
    .order("name");
  return (data ?? [])
    .filter((v) => filters.inactive === "1" || v.is_active)
    .filter((v) => !filters.area || v.area_id === filters.area)
    .filter((v) => !filters.q || matchesQuery(filters.q, { text: [v.name, v.kana, v.address, v.nearest_station] }));
}

export async function getVenueDetail(id: string) {
  const supabase = await createClient();
  const { data: venue } = await supabase.from("venues").select("*").eq("id", id).maybeSingle();
  if (!venue) return null;
  const { data: events } = await supabase
    .from("events")
    .select("id, date, start_time, end_time, cancelled_at, client:companies(id, name), assignments(status, report_items(reported_count, confirmed_count))")
    .eq("venue_id", id)
    .order("date", { ascending: false })
    .limit(100);

  const rows = (events ?? []).map((e) => {
    const worked = e.assignments.filter((a) => a.status === "confirmed");
    const items = worked.flatMap((a) => a.report_items);
    return {
      id: e.id,
      date: e.date,
      cancelled: Boolean(e.cancelled_at),
      client: e.client,
      worked: worked.length,
      confirmed: items.some((i) => i.confirmed_count != null) ? items.reduce((s, i) => s + (i.confirmed_count ?? 0), 0) : null,
      reported: items.some((i) => i.reported_count != null) ? items.reduce((s, i) => s + (i.reported_count ?? 0), 0) : null,
    };
  });

  // 主な取引先: 過去の現場の多い順
  const counts = new Map<string, { name: string; count: number }>();
  for (const r of rows) {
    if (!r.client || r.cancelled) continue;
    const c = counts.get(r.client.id) ?? { name: r.client.name, count: 0 };
    c.count += 1;
    counts.set(r.client.id, c);
  }
  const mainClients = [...counts.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5).map(([cid, c]) => ({ id: cid, ...c }));
  return { venue, events: rows, mainClients };
}
