import "server-only";
import { buildBoard, type BoardAssignment, type BoardStaff } from "@/lib/board";
import { monthRange, todayJst } from "@/lib/date";
import { holidaysBetween } from "@/lib/date/holidays";
import { getMasters } from "@/lib/data/masters";
import { siteUrl } from "@/lib/supabase/env";
import { selectAll } from "@/lib/supabase/select-all";
import { createClient } from "@/lib/supabase/server";

const LIVE_STATUSES = ["offered", "confirmed", "waitlisted"] as const;

/** 稼働表の画面（管理画面）用。マスを押したときの打診・確定に使う情報も一緒に返す */
export async function loadBoard(month: string) {
  const supabase = await createClient();
  const { start, end } = monthRange(month);
  const [events, assignments, availability, activeStaff, ng, tpl, masters] = await Promise.all([
    selectAll((from, to) =>
      supabase
        .from("event_overview")
        .select(
          "id, date, start_time, end_time, meeting_time, meeting_place, belongings, client_id, venue_id, cancelled_at, required_total, confirmed_total, shortage_total, offered_count, by_role, venue:venues(id, name, address), client:companies(id, name)",
        )
        .gte("date", start)
        .lte("date", end)
        .order("date")
        .order("id")
        .range(from, to),
    ),
    selectAll((from, to) =>
      supabase
        .from("assignments")
        .select("id, event_id, staff_id, role_id, status, event:events!inner(date)")
        .in("status", [...LIVE_STATUSES])
        .gte("event.date", start)
        .lte("event.date", end)
        .order("id")
        .range(from, to),
    ),
    selectAll((from, to) =>
      supabase.from("availability").select("staff_id, date, status").gte("date", start).lte("date", end).order("staff_id").order("date").range(from, to),
    ),
    selectAll((from, to) =>
      supabase
        .from("staff")
        .select("id, name, kana, nearest_station, rank_id, mypage_token, staff_roles(role_id)")
        .eq("status", "active")
        .order("id")
        .range(from, to),
    ),
    selectAll((from, to) => supabase.from("staff_ng").select("staff_id, venue_id, company_id").order("id").range(from, to)),
    supabase.from("message_templates").select("body").eq("kind", "offer").maybeSingle(),
    getMasters(),
  ]);

  // 稼働中でなくても、この月にアサインがある人は出す
  const activeIds = new Set(activeStaff.map((s) => s.id));
  const missing = [...new Set(assignments.map((a) => a.staff_id))].filter((id) => !activeIds.has(id));
  const extraStaff = missing.length
    ? ((await supabase.from("staff").select("id, name, kana, nearest_station, rank_id, mypage_token, staff_roles(role_id)").in("id", missing)).data ?? [])
    : [];
  const staffRows = [...activeStaff, ...extraStaff];

  const board = buildBoard({
    month,
    today: todayJst(),
    holidays: holidaysBetween(start, end),
    events: events.map((e) => ({
      id: e.id!,
      date: e.date!,
      client_id: e.client_id!,
      client_name: e.client?.name ?? "",
      venue_id: e.venue_id!,
      venue_name: e.venue?.name ?? "",
      required_total: e.required_total ?? 0,
      confirmed_total: e.confirmed_total ?? 0,
      shortage_total: e.shortage_total ?? 0,
      offered_count: e.offered_count ?? 0,
      cancelled: e.cancelled_at != null,
    })),
    staff: staffRows.map(
      (s): BoardStaff => ({
        id: s.id,
        name: s.name,
        kana: s.kana,
        nearest_station: s.nearest_station,
        rank_name: s.rank_id ? (masters.rankById.get(s.rank_id)?.name ?? null) : null,
        rank_order: s.rank_id ? (masters.rankById.get(s.rank_id)?.sort_order ?? null) : null,
      }),
    ),
    assignments: assignments.map((a): BoardAssignment => ({ id: a.id, event_id: a.event_id, staff_id: a.staff_id, role_id: a.role_id, status: a.status as BoardAssignment["status"] })),
    availability,
  });

  const ngByStaff = new Map<string, { venues: string[]; clients: string[] }>();
  for (const n of ng) {
    const cur = ngByStaff.get(n.staff_id) ?? { venues: [], clients: [] };
    if (n.venue_id) cur.venues.push(n.venue_id);
    if (n.company_id) cur.clients.push(n.company_id);
    ngByStaff.set(n.staff_id, cur);
  }

  return {
    board,
    events: Object.fromEntries(
      events.map((e) => [
        e.id!,
        {
          id: e.id!,
          date: e.date!,
          clientId: e.client_id!,
          venueId: e.venue_id!,
          clientName: e.client?.name ?? "",
          venueName: e.venue?.name ?? "",
          cancelled: e.cancelled_at != null,
          shortage: e.shortage_total ?? 0,
          byRole: (e.by_role ?? {}) as Record<string, { required: number; confirmed: number; shortage: number }>,
          message: {
            date: e.date!,
            start_time: e.start_time,
            end_time: e.end_time,
            meeting_time: e.meeting_time,
            meeting_place: e.meeting_place,
            belongings: e.belongings,
            venue: { name: e.venue?.name ?? "", address: e.venue?.address ?? "" },
          },
        },
      ]),
    ),
    staff: Object.fromEntries(
      staffRows.map((s) => [
        s.id,
        { mypageToken: s.mypage_token, roleIds: s.staff_roles.map((r) => r.role_id), ngVenueIds: ngByStaff.get(s.id)?.venues ?? [], ngClientIds: ngByStaff.get(s.id)?.clients ?? [] },
      ]),
    ),
    roles: masters.roles.map((r) => ({ id: r.id, name: r.name })),
    offerTemplate: tpl.data?.body ?? "",
    siteUrl: siteUrl(),
  };
}

export type BoardPageData = Awaited<ReturnType<typeof loadBoard>>;
export type BoardEventInfo = BoardPageData["events"][string];
export type BoardStaffInfo = BoardPageData["staff"][string];
