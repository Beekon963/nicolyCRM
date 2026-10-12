import "server-only";
import { todayJst } from "@/lib/date";
import { selectAll } from "@/lib/supabase/select-all";
import { createClient } from "@/lib/supabase/server";

/**
 * 友達紹介（Phase 12）。「紹介してくれた人」（staff.referred_by）と、紹介された人の稼働の回数。
 * 稼働 = 確定のアサインで、中止でない現場の、今日までの日（記録のみの現場も数える）
 */

export type ReferredStaff = { staffId: string; name: string; referrerId: string; referrerName: string; worked: number; reachedOn: string | null };

/** 紹介された人ごとの稼働の回数（after 回目の日も）。referrerId を渡すとその人が紹介した人だけ */
export async function getReferredStaff(after: number, referrerId?: string): Promise<ReferredStaff[]> {
  const supabase = await createClient();
  let q = supabase.from("staff").select("id, name, referred_by").not("referred_by", "is", null);
  if (referrerId) q = q.eq("referred_by", referrerId);
  const { data: referred } = await q;
  const list = (referred ?? []).filter((s): s is typeof s & { referred_by: string } => s.referred_by != null);
  if (!list.length) return [];
  const ids = list.map((s) => s.id);
  const [{ data: referrers }, worked] = await Promise.all([
    supabase.from("staff").select("id, name").in("id", [...new Set(list.map((s) => s.referred_by))]),
    selectAll((f, t) =>
      supabase
        .from("assignments")
        .select("staff_id, event:events!inner(date, cancelled_at)")
        .eq("status", "confirmed")
        .in("staff_id", ids)
        .is("event.cancelled_at", null)
        .lte("event.date", todayJst())
        .order("id")
        .range(f, t),
    ),
  ]);
  const nameOf = new Map((referrers ?? []).map((r) => [r.id, r.name]));
  const dates = new Map<string, string[]>();
  for (const w of worked) dates.set(w.staff_id, [...(dates.get(w.staff_id) ?? []), w.event.date]);
  return list.map((s) => {
    const ds = (dates.get(s.id) ?? []).sort();
    return { staffId: s.id, name: s.name, referrerId: s.referred_by, referrerName: nameOf.get(s.referred_by) ?? "", worked: ds.length, reachedOn: ds[after - 1] ?? null };
  });
}

/** ★ ボーナスを足せる人（決めた回数に届いて、まだ足していない人）。オーナーだけ */
export async function getReferralBonusTargets(after: number): Promise<ReferredStaff[]> {
  const supabase = await createClient();
  const [all, { data: done }] = await Promise.all([getReferredStaff(after), supabase.from("referral_bonuses").select("referred_staff_id")]);
  const given = new Set((done ?? []).map((d) => d.referred_staff_id));
  return all.filter((s) => s.worked >= after && !given.has(s.staffId)).sort((a, b) => (a.reachedOn ?? "").localeCompare(b.reachedOn ?? ""));
}
