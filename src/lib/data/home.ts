import "server-only";
import { addDays, monthRange, nextMonth, monthOf, todayJst } from "@/lib/date";
import { createClient } from "@/lib/supabase/server";
import { getGeneralSettings } from "@/lib/settings";

const EVENT_SELECT =
  "id, date, start_time, end_time, status, required_total, confirmed_total, shortage_total, offered_count, unreported_count, reminder_pending, cancelled_at, venue:venues(name), client:companies(name)";

/** ホームの「今日・明日の現場」「要対応」（お金以外。要件 §4.1） */
export async function getHomeData() {
  const supabase = await createClient();
  const today = todayJst();
  const tomorrow = addDays(today, 1);
  const settings = await getGeneralSettings();
  const next = nextMonth(monthOf(today));
  const deadline = `${monthOf(today)}-${String(settings.availabilityDeadlineDay).padStart(2, "0")}`;

  const [todayTomorrow, shortages, offers, unreported, expenses, activeStaff, submitted] = await Promise.all([
    supabase.from("event_overview").select(EVENT_SELECT).in("date", [today, tomorrow]).is("cancelled_at", null).order("date").order("start_time"),
    supabase
      .from("event_overview")
      .select(EVENT_SELECT)
      .gte("date", today)
      .lte("date", addDays(today, 7))
      .gt("shortage_total", 0)
      .is("cancelled_at", null)
      .order("date"),
    supabase
      .from("assignments")
      .select("id, offered_at, staff:staff(name), event:events!inner(id, date, cancelled_at, venue:venues(name))")
      .eq("status", "offered")
      .gte("event.date", today)
      .is("event.cancelled_at", null)
      .order("offered_at"),
    supabase
      .from("assignments")
      .select("id, staff:staff(name), report:reports(submitted_at), event:events!inner(id, date, cancelled_at, venue:venues(name))")
      .eq("status", "confirmed")
      .lt("event.date", today)
      .gte("event.date", addDays(today, -30))
      .is("event.cancelled_at", null)
      .eq("event.report_required", true),
    supabase.from("expenses").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("staff").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("availability_submissions").select("staff_id, staff:staff!inner(status)").eq("month", `${next}-01`).not("submitted_at", "is", null).eq("staff.status", "active"),
  ]);

  // 直近の稼働から（要件 §9-8: 直近・要対応が上）
  const unreportedRows = (unreported.data ?? []).filter((a) => !a.report?.submitted_at).sort((a, b) => b.event.date.localeCompare(a.event.date));
  const offerRows = offers.data ?? [];
  const now = Date.now();
  return {
    today,
    tomorrow,
    todayTomorrow: todayTomorrow.data ?? [],
    shortages: shortages.data ?? [],
    offers: offerRows.map((o) => ({ ...o, overdue: now - new Date(o.offered_at).getTime() > 24 * 3600_000 })),
    unreported: unreportedRows,
    pendingExpenses: expenses.count ?? 0,
    reminderPending: (todayTomorrow.data ?? []).filter((e) => e.date === tomorrow && (e.reminder_pending ?? 0) > 0),
    availability: {
      month: next,
      deadline,
      late: today > deadline,
      missing: Math.max(0, (activeStaff.count ?? 0) - (submitted.data?.length ?? 0)),
    },
  };
}

export type Ranking = { id: string; name: string; total: number }[];

/** 今月の獲得件数トップ（スタッフ別・会場別・取引先別。確定 / 速報） */
export async function getMonthRanking(basis: "confirmed" | "reported") {
  const supabase = await createClient();
  const { start, end } = monthRange(monthOf(todayJst()));
  const { data } = await supabase
    .from("report_items")
    .select("reported_count, confirmed_count, assignment:assignments!inner(status, staff:staff(id, name), event:events!inner(date, cancelled_at, venue:venues(id, name), client:companies(id, name)))")
    .gte("assignment.event.date", start)
    .lte("assignment.event.date", end)
    .eq("assignment.status", "confirmed")
    .is("assignment.event.cancelled_at", null);
  const add = (m: Map<string, { name: string; total: number }>, id: string | undefined, name: string | undefined, n: number) => {
    if (!id || !n) return;
    const cur = m.get(id) ?? { name: name ?? "", total: 0 };
    cur.total += n;
    m.set(id, cur);
  };
  const staff = new Map(), venues = new Map(), clients = new Map();
  for (const r of data ?? []) {
    const n = (basis === "confirmed" ? r.confirmed_count : r.reported_count) ?? 0;
    add(staff, r.assignment.staff?.id, r.assignment.staff?.name, n);
    add(venues, r.assignment.event.venue?.id, r.assignment.event.venue?.name, n);
    add(clients, r.assignment.event.client?.id, r.assignment.event.client?.name, n);
  }
  const top = (m: Map<string, { name: string; total: number }>): Ranking =>
    [...m.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.total - a.total).slice(0, 5);
  return { staff: top(staff), venues: top(venues), clients: top(clients) };
}
