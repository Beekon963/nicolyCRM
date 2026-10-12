import "server-only";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { ASSIGNMENT_STATUS } from "@/lib/labels";
import type { createClient } from "@/lib/supabase/server";

/**
 * 事務がスタッフの代わりに実績の報告（速報）を入れる。AI の確認カードと「LINEの報告を変換 → 実績に入れる」で使う。
 * 入れるのは確定したアサインで、まだ本人が報告していない・確定していない・中止でない・今日までの現場だけ
 */

type Db = Awaited<ReturnType<typeof createClient>>;
export type ReportEntryContext = { supabase: Db; today: string };
export type ReportEntry = { assignment_id: string; counts: { item_id: string; count: number }[]; comment: string };

export type ReportAsg = {
  id: string;
  status: keyof typeof ASSIGNMENT_STATUS;
  role_id: string;
  staff: { name: string } | null;
  event: { date: string; client_id: string; cancelled_at: string | null; venue: { name: string } | null; client: { name: string } | null } | null;
  report: { submitted_at: string | null; confirmed_at: string | null } | null;
};

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export async function loadReportTargets(ctx: ReportEntryContext, ids: string[]): Promise<Map<string, ReportAsg>> {
  const { data } = await ctx.supabase
    .from("assignments")
    .select("id, status, role_id, staff:staff(name), event:events(date, client_id, cancelled_at, venue:venues(name), client:companies(name)), report:reports(submitted_at, confirmed_at)")
    .in("id", ids);
  return new Map(
    (data ?? []).map((a) => {
      const ev = one(a.event);
      const row: ReportAsg = { ...a, staff: one(a.staff), event: ev ? { ...ev, venue: one(ev.venue), client: one(ev.client) } : null, report: one(a.report) };
      return [a.id, row];
    }),
  );
}

/** 報告を入れられない理由（入れられるなら null） */
export function reportSkip(a: ReportAsg | undefined, today: string): string | null {
  if (!a || !a.event) return "見つかりません";
  if (a.status !== "confirmed") return `状態が「${ASSIGNMENT_STATUS[a.status].label}」です`;
  if (a.event.cancelled_at) return "中止の現場です";
  if (a.event.date > today) return "まだ先の現場です";
  if (a.report?.confirmed_at) return "実績はもう確定しています（実績確認の画面で直せます）";
  if (a.report?.submitted_at) return "本人がもう報告しています（実績確認の画面で確定してください）";
  return null;
}

/** 速報として入れる（入力元は「管理者」）。入れられない人は飛ばして、名前と理由を返す */
export async function enterReports(ctx: ReportEntryContext, entries: ReportEntry[]): Promise<ActionResult> {
  const targets = await loadReportTargets(ctx, entries.map((e) => e.assignment_id));
  let done = 0;
  const skipped: string[] = [];
  for (const e of entries) {
    const a = targets.get(e.assignment_id);
    const why = reportSkip(a, ctx.today);
    if (why) {
      skipped.push(`${a?.staff?.name ?? ""}: ${why}`);
      continue;
    }
    const { error } = await ctx.supabase.from("reports").upsert({ assignment_id: e.assignment_id, submitted_at: new Date().toISOString(), source: "admin", comment: e.comment });
    if (error) return fail(dbErrorMessage(error));
    if (e.counts.length) {
      const { error: ie } = await ctx.supabase.from("report_items").upsert(e.counts.map((c) => ({ assignment_id: e.assignment_id, item_id: c.item_id, reported_count: c.count })));
      if (ie) return fail(dbErrorMessage(ie));
    }
    done++;
  }
  if (!done) return fail(`入れられる報告がありません（${skipped.join(" / ")}）`);
  return ok(`${done}人分の報告を入れました${skipped.length ? `（入れなかった人: ${skipped.join(" / ")}）` : ""}。確定は「実績確認」で行ってください`);
}
