import "server-only";
import { analyze, type Basis, type GroupBy, rangeOf } from "@/lib/analysis";
import { addDays, nextMonth, monthOf, todayJst } from "@/lib/date";
import { loadResultRows } from "@/lib/data/analysis";
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

/** 今月の獲得件数トップ（スタッフ別・会場別・取引先別。確定 / 速報）。数え方は「実績の分析」と同じ */
export async function getMonthRanking(basis: Basis) {
  const { start, end } = rangeOf("month", todayJst());
  const rows = await loadResultRows(start, end);
  const top = (by: GroupBy): Ranking =>
    analyze(rows, by, basis)
      .filter((g) => g.total > 0)
      .slice(0, 5)
      .map(({ id, name, total }) => ({ id, name, total }));
  return { staff: top("staff"), venues: top("venue"), clients: top("client") };
}
