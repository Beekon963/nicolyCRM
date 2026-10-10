import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth";
import { addDays, formatShortJa, todayJst } from "@/lib/date";
import { getMasters } from "@/lib/data/masters";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ConfirmEventButton, ResultRow, type ResultAssignment } from "./result-row";

export const metadata = { title: "実績確認 | NICOLY CRM" };

export default async function ResultsPage({ searchParams }: PageProps<"/results">) {
  await requireMember();
  const sp = await searchParams;
  const eventId = typeof sp.event === "string" ? sp.event : undefined;
  const show = sp.show === "all" ? "all" : "open";
  const today = todayJst();
  const supabase = await createClient();
  const masters = await getMasters();

  let q = supabase
    .from("assignments")
    .select(
      "id, staff_id, role_id, staff:staff(name), event:events!inner(id, date, client_id, cancelled_at, venue:venues(name), client:companies(name)), report:reports(submitted_at, confirmed_at, comment, source), report_items(item_id, reported_count, confirmed_count, diff_reason, diff_note)",
    )
    .eq("status", "confirmed")
    .is("event.cancelled_at", null)
    .eq("event.report_required", true)
    .lte("event.date", today);
  q = eventId ? q.eq("event_id", eventId) : q.gte("event.date", addDays(today, -45));
  const [{ data }, { data: companyItems }] = await Promise.all([q, supabase.from("company_items").select("company_id, item_id")]);

  const itemsFor = (clientId: string) => {
    const chosen = (companyItems ?? []).filter((c) => c.company_id === clientId).map((c) => c.item_id);
    return masters.items.filter((i) => (chosen.length ? chosen.includes(i.id) : i.is_active));
  };

  type Group = { event: NonNullable<(typeof data)>[number]["event"]; rows: ResultAssignment[]; bulk: number };
  const groups = new Map<string, Group>();
  for (const a of data ?? []) {
    const confirmed = Boolean(a.report?.confirmed_at);
    if (show === "open" && confirmed && !eventId) continue;
    const base = itemsFor(a.event.client_id);
    const extra = a.report_items.filter((ri) => !base.some((b) => b.id === ri.item_id)).map((ri) => masters.itemById.get(ri.item_id)!).filter(Boolean);
    const items = [...base, ...extra].map((it) => {
      const ri = a.report_items.find((x) => x.item_id === it.id);
      return { item_id: it.id, name: it.name, reported: ri?.reported_count ?? null, confirmed: ri?.confirmed_count ?? null, reason: ri?.diff_reason ?? null, note: ri?.diff_note ?? "" };
    });
    const g = groups.get(a.event.id) ?? { event: a.event, rows: [], bulk: 0 };
    g.rows.push({
      id: a.id,
      staffId: a.staff_id,
      name: a.staff?.name ?? "",
      role: masters.roleById.get(a.role_id)?.name ?? "",
      submitted: Boolean(a.report?.submitted_at),
      confirmed,
      source: a.report?.source ?? null,
      comment: a.report?.comment ?? "",
      items,
    });
    if (a.report?.submitted_at && !confirmed) g.bulk += 1;
    groups.set(a.event.id, g);
  }
  const list = [...groups.values()].sort((x, y) => y.event.date.localeCompare(x.event.date));
  const itemNames = new Map(masters.items.map((i) => [i.id, i.name]));

  return (
    <>
      <PageHeader
        title="実績確認"
        description="速報（スタッフの報告）を確認して、確定件数を決めます。請求・支払いは確定件数で計算します。"
        back={eventId ? `/events/${eventId}` : undefined}
      />
      {!eventId && (
        <div className="mx-4 mb-3 flex gap-1 rounded-lg bg-muted p-1">
          {[
            { v: "open", label: "未確定がある現場" },
            { v: "all", label: "直近45日すべて" },
          ].map((t) => (
            <Link
              key={t.v}
              href={`/results?show=${t.v}`}
              className={cn("flex h-11 flex-1 items-center justify-center rounded-md", t.v === show ? "bg-background font-bold shadow-sm" : "text-muted-foreground")}
            >
              {t.label}
            </Link>
          ))}
        </div>
      )}
      {list.length === 0 ? (
        <EmptyState title="確定待ちの実績はありません">スタッフが実績を報告すると、ここに出ます。</EmptyState>
      ) : (
        <div className="flex flex-col gap-4 px-4">
          {list.map((g) => (
            <section key={g.event.id} className="rounded-lg border">
              <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
                <Link href={`/events/${g.event.id}`} className="min-w-0 flex-1 hover:underline">
                  <span className="font-bold">{formatShortJa(g.event.date)}</span> {g.event.venue?.name}
                  <span className="block text-sm text-muted-foreground">{g.event.client?.name}</span>
                </Link>
                <ConfirmEventButton eventId={g.event.id} count={g.bulk} />
              </div>
              <ul className="divide-y">
                {g.rows.map((r) => (
                  <ResultRow key={r.id} a={r} itemNames={itemNames} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
