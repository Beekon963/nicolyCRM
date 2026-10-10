import "server-only";
import type { ResultRow } from "@/lib/analysis";
import { selectAll } from "@/lib/supabase/select-all";
import { createClient } from "@/lib/supabase/server";

/** 期間内の確定したアサインと件数（中止の現場は除く。金額は取らない） */
export async function loadResultRows(start: string, end: string): Promise<ResultRow[]> {
  const supabase = await createClient();
  const rows = await selectAll((from, to) =>
    supabase
      .from("assignments")
      .select(
        "id, staff:staff(id, name), event:events!inner(id, date, cancelled_at, venue:venues(id, name), client:companies(id, name)), report:reports(submitted_at, confirmed_at), report_items(item_id, reported_count, confirmed_count)",
      )
      .eq("status", "confirmed")
      .gte("event.date", start)
      .lte("event.date", end)
      .is("event.cancelled_at", null)
      .order("id")
      .range(from, to),
  );
  return rows.map((a) => ({
    eventId: a.event.id,
    date: a.event.date,
    staff: a.staff,
    venue: a.event.venue,
    client: a.event.client,
    submittedAt: a.report?.submitted_at ?? null,
    confirmedAt: a.report?.confirmed_at ?? null,
    items: a.report_items,
  }));
}
