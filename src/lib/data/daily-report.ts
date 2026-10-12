import "server-only";
import { parse, weekdayJa } from "@/lib/date";
import { getMasters } from "@/lib/data/masters";
import { dictFor, loadAliases } from "@/lib/data/report-dict";
import { renameItems } from "@/lib/report-convert";
import type { ReportDay, ReportFormatBlocks } from "@/lib/report-format";
import { formatTimeRange } from "@/lib/templates";
import { createClient } from "@/lib/supabase/server";

export type DailyFormat = ReportFormatBlocks & { id: string; name: string; companyId: string | null };
export type DailyClient = { id: string; name: string; day: ReportDay; reported: number; total: number; formats: DailyFormat[] };

/**
 * その日の日報（取引先ごと）。確定した人（当日不稼働・キャンセルは除く）の報告の件数とコメントを集める。
 * 件数は確定があれば確定、なければ速報。金額は読まない（管理者も使う）。
 */
export async function loadDailyReports(date: string): Promise<DailyClient[]> {
  const supabase = await createClient();
  const [{ data: events }, { data: formats }, { data: companyItems }, masters] = await Promise.all([
    supabase
      .from("events")
      .select(
        "id, client_id, start_time, end_time, client:companies(name), venue:venues(name), assignments(id, status, role_id, staff:staff(name, kana), report:reports(submitted_at, comment), report_items(item_id, reported_count, confirmed_count))",
      )
      .eq("date", date)
      .is("cancelled_at", null)
      .order("start_time", { nullsFirst: false }),
    supabase.from("report_formats").select("id, name, company_id, header, event_block, person_block, footer").eq("is_active", true).order("sort_order").order("name"),
    supabase.from("company_items").select("company_id, item_id"),
    getMasters(),
  ]);
  const aliases = await loadAliases();

  const { m, d } = parse(date);
  const label = `${m}/${d}`;
  const weekday = weekdayJa(date);
  const roleOrder = new Map(masters.roles.map((r) => [r.id, r.sort_order]));

  const byClient = new Map<string, DailyClient>();
  for (const ev of events ?? []) {
    const chosen = (companyItems ?? []).filter((c) => c.company_id === ev.client_id).map((c) => c.item_id);
    const counted = new Set(ev.assignments.flatMap((a) => a.report_items.filter((ri) => ri.reported_count != null || ri.confirmed_count != null).map((ri) => ri.item_id)));
    const items = masters.items.filter((i) => (chosen.length ? chosen.includes(i.id) : i.is_active) || counted.has(i.id));
    // 言いかえ表があれば、項目名を取引先の名前（公認名称）に直す
    const dict = dictFor(ev.client_id, items.map((i) => i.name), aliases);

    const worked = ev.assignments
      .filter((a) => a.status === "confirmed")
      .sort((a, b) => (roleOrder.get(a.role_id) ?? 0) - (roleOrder.get(b.role_id) ?? 0) || (a.staff?.kana ?? "").localeCompare(b.staff?.kana ?? "", "ja"));
    const people = worked.map((a) => {
      const report = Array.isArray(a.report) ? a.report[0] : a.report;
      const unreported = !report?.submitted_at && a.report_items.every((ri) => ri.reported_count == null && ri.confirmed_count == null);
      return {
        name: a.staff?.name ?? "",
        role: masters.roleById.get(a.role_id)?.name ?? "",
        items: renameItems(
          items.map((i) => {
            const ri = a.report_items.find((x) => x.item_id === i.id);
            return { name: i.name, count: ri ? (ri.confirmed_count ?? ri.reported_count) : null };
          }),
          dict,
        ),
        comment: report?.comment ?? "",
        unreported,
      };
    });

    const cur =
      byClient.get(ev.client_id) ??
      ({
        id: ev.client_id,
        name: ev.client?.name ?? "",
        day: { date: label, weekday, clientName: ev.client?.name ?? "", events: [] },
        reported: 0,
        total: 0,
        formats: (formats ?? [])
          .filter((f) => f.company_id == null || f.company_id === ev.client_id)
          .sort((a, b) => Number(a.company_id == null) - Number(b.company_id == null))
          .map((f) => ({ id: f.id, name: f.name, companyId: f.company_id, header: f.header, eventBlock: f.event_block, personBlock: f.person_block, footer: f.footer })),
      } satisfies DailyClient);
    cur.day.events.push({ venueName: ev.venue?.name ?? "", time: formatTimeRange(ev.start_time, ev.end_time), people });
    cur.total += people.length;
    cur.reported += people.filter((p) => !p.unreported).length;
    byClient.set(ev.client_id, cur);
  }
  return [...byClient.values()].sort((a, b) => a.name.localeCompare(b.name, "ja"));
}
