import "server-only";
import { todayJst } from "@/lib/date";
import { createClient } from "@/lib/supabase/server";

/**
 * キャンセル・当日不稼働のお知らせ（Phase 6）。画面のポップアップに出すもの。
 * - まだ見ていないもの（alert_seen より後。初めての人は直近1日）だけ
 * - 自分で操作したものは出さない
 * - 今もキャンセル・当日不稼働のままで、今日以降の中止でない現場だけ（元に戻したものは出さない）
 * ログイン中の人の権限で読む（金額は扱わない）。
 */
export type DropAlert = {
  id: string;
  createdAt: string;
  status: "cancelled" | "no_show";
  eventId: string;
  date: string;
  venueName: string;
  venueColor: string;
  clientName: string;
  roleName: string;
  staffName: string;
  /** その現場の今の欠員（人） */
  shortage: number;
};

export async function loadDropAlerts(userId: string, now: Date = new Date()): Promise<DropAlert[]> {
  const supabase = await createClient();
  const { data: seen } = await supabase.from("alert_seen").select("seen_at").eq("user_id", userId).maybeSingle();
  const since = seen?.seen_at ?? new Date(now.getTime() - 24 * 3600_000).toISOString();
  const { data } = await supabase
    .from("assignment_alerts")
    .select(
      "id, status, created_at, actor_user_id, assignment:assignments(status, staff:staff(name), role:roles(name), event:events(id, date, cancelled_at, venue:venues(name, color), client:companies(name)))",
    )
    .gt("created_at", since)
    .order("created_at")
    .limit(50);
  const today = todayJst(now);
  const rows = (data ?? []).filter((r) => {
    const ev = r.assignment?.event;
    return r.actor_user_id !== userId && r.assignment?.status === r.status && ev && !ev.cancelled_at && ev.date >= today;
  });
  if (!rows.length) return [];
  const eventIds = [...new Set(rows.map((r) => r.assignment!.event!.id))];
  const { data: overview } = await supabase.from("event_overview").select("id, shortage_total").in("id", eventIds);
  const shortage = new Map((overview ?? []).map((o) => [o.id, o.shortage_total ?? 0]));
  return rows.map((r) => {
    const a = r.assignment!;
    const ev = a.event!;
    return {
      id: r.id,
      createdAt: r.created_at,
      status: r.status as DropAlert["status"],
      eventId: ev.id,
      date: ev.date,
      venueName: ev.venue?.name ?? "",
      venueColor: ev.venue?.color ?? "",
      clientName: ev.client?.name ?? "",
      roleName: a.role?.name ?? "",
      staffName: a.staff?.name ?? "",
      shortage: shortage.get(ev.id) ?? 0,
    };
  });
}

/** ここまで見た（upTo は出したお知らせの一番新しい時刻。押すまでの間に入ったものは次に出す） */
export async function markDropAlertsSeen(userId: string, upTo: string): Promise<void> {
  const supabase = await createClient();
  const { data: seen } = await supabase.from("alert_seen").select("seen_at").eq("user_id", userId).maybeSingle();
  if (seen && new Date(seen.seen_at) >= new Date(upTo)) return;
  await supabase.from("alert_seen").upsert({ user_id: userId, seen_at: upTo });
}
