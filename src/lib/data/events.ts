import "server-only";
import { addDays, monthRange, todayJst } from "@/lib/date";
import { createClient } from "@/lib/supabase/server";

export type EventFilters = {
  view?: string;
  from?: string;
  to?: string;
  month?: string;
  client?: string;
  venue?: string;
  shortage?: string;
  status?: string;
  group?: string;
};

const OVERVIEW_SELECT =
  "id, date, start_time, end_time, meeting_time, client_id, venue_id, group_id, cancelled_at, status, required_total, confirmed_total, shortage_total, offered_count, waitlisted_count, oldest_offer_at, unreported_count, unconfirmed_result_count, confirm_notice_pending, reminder_pending, by_role, venue:venues(id, name, area_id), client:companies(id, name)";

/** 現場一覧（初期表示は今日から2週間。要件 §4.2） */
export async function listEvents(f: EventFilters) {
  const supabase = await createClient();
  const today = todayJst();
  let from = f.from ?? today;
  let to = f.to ?? addDays(from, 13);
  if (f.view === "calendar") {
    const r = monthRange(f.month ?? today.slice(0, 7));
    from = r.start;
    to = r.end;
  }
  let q = supabase.from("event_overview").select(OVERVIEW_SELECT);
  if (!f.group) q = q.gte("date", from).lte("date", to);
  if (f.group) q = q.eq("group_id", f.group);
  if (f.client) q = q.eq("client_id", f.client);
  if (f.venue) q = q.eq("venue_id", f.venue);
  if (f.shortage === "1") q = q.gt("shortage_total", 0).is("cancelled_at", null);
  if (f.status) q = q.eq("status", f.status);
  const { data } = await q.order("date").order("start_time");
  return { events: data ?? [], from, to };
}

export type EventListItem = Awaited<ReturnType<typeof listEvents>>["events"][number];

export async function getEventDetail(id: string) {
  const supabase = await createClient();
  const [{ data: event }, { data: requirements }, { data: assignments }] = await Promise.all([
    supabase.from("event_overview").select(`${OVERVIEW_SELECT}, meeting_place, belongings, notes, cancel_reason, group:event_groups(id, name)`).eq("id", id).maybeSingle(),
    supabase.from("event_requirements").select("role_id, required_count").eq("event_id", id),
    supabase
      .from("assignments")
      .select(
        "id, staff_id, role_id, status, offered_at, responded_at, response_source, confirm_notice_sent_at, reminder_sent_at, cancel_reason_code, cancel_reason, staff:staff(id, name, kana, phone, mypage_token, rank_id), report:reports(submitted_at, confirmed_at, comment, source)",
      )
      .eq("event_id", id)
      .order("offered_at"),
  ]);
  if (!event) return null;
  const { data: venue } = await supabase.from("venues").select("*").eq("id", event.venue_id!).single();
  return { event, venue: venue!, requirements: requirements ?? [], assignments: assignments ?? [] };
}

export type EventDetail = NonNullable<Awaited<ReturnType<typeof getEventDetail>>>;
