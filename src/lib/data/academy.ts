import "server-only";
import { type AcademyBadge, type AcademyProgress, decisionOf, toAcademyProgress } from "@/lib/academy";
import { createClient } from "@/lib/supabase/server";

/**
 * NICOLY アカデミーの記録（Phase 14）。お金の情報はないので、オーナー・管理者が読める。
 * スタッフのマイページ・見るだけリンク・AI の道具には出さない
 */

/** スタッフの詳細に出す記録（まだ取り込んでいなければ null） */
export async function getAcademyProgress(staffId: string): Promise<AcademyProgress | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("academy_progress").select("*").eq("staff_id", staffId).maybeSingle();
  return data ? toAcademyProgress(data) : null;
}

/** 打診の候補などに出す札（称号と稼働判断）。記録のない人は入らない */
export async function getAcademyBadges(staffIds: string[]): Promise<Map<string, AcademyBadge>> {
  if (!staffIds.length) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.from("academy_progress").select("staff_id, title, decision").in("staff_id", staffIds);
  return new Map((data ?? []).map((r) => [r.staff_id, { title: r.title, decision: decisionOf(r.decision) }]));
}

/** 取り込みの画面: もう結びついているアカデミーの ID → スタッフ */
export async function getAcademyLinks(): Promise<Record<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase.from("academy_progress").select("staff_id, academy_id");
  return Object.fromEntries((data ?? []).map((r) => [r.academy_id, r.staff_id]));
}
