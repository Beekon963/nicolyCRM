import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, ListIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { FilterBar } from "@/components/app/filter-bar";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { addDays, eachDay, formatShortJa, monthRange, nextMonth, parse, weekdayJa } from "@/lib/date";
import type { EventFilters, EventListItem } from "@/lib/data/events";
import { EVENT_STATUS } from "@/lib/labels";
import { formatTimeRange } from "@/lib/templates";
import { cn } from "@/lib/utils";

type Opt = { id: string; name: string };

function qs(base: EventFilters, patch: Partial<EventFilters>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** 人数の表示: 確定/必要。欠員は赤、埋まったら緑（要件 §9-5） */
export function StaffCount({ e }: { e: Pick<EventListItem, "confirmed_total" | "required_total" | "shortage_total" | "offered_count" | "cancelled_at"> }) {
  if (e.cancelled_at) return <Badge tone="muted">中止</Badge>;
  return (
    <span className="flex flex-col items-end gap-0.5">
      <Badge tone={e.shortage_total! > 0 ? "alert" : "done"}>
        {e.confirmed_total}/{e.required_total}人{e.shortage_total! > 0 && ` 欠員${e.shortage_total}`}
      </Badge>
      {e.offered_count! > 0 && <span className="text-xs text-status-waiting">打診中 {e.offered_count}</span>}
    </span>
  );
}

export function EventList({
  events,
  filters,
  from,
  to,
  holidays,
  clients,
  venues,
  selectedId,
  group,
}: {
  events: EventListItem[];
  filters: EventFilters;
  from: string;
  to: string;
  holidays: Record<string, string>;
  clients: Opt[];
  venues: Opt[];
  selectedId?: string;
  group?: { id: string; name: string } | null;
}) {
  const calendar = filters.view === "calendar" && !filters.group;
  const byDate = new Map<string, EventListItem[]>();
  for (const e of events) byDate.set(e.date!, [...(byDate.get(e.date!) ?? []), e]);
  const month = (filters.month ?? from).slice(0, 7);
  const span = 14;

  return (
    <>
      <PageHeader
        title={group ? `グループ: ${group.name}` : "現場"}
        description={group ? `${events.length}件` : undefined}
        back={group ? "/events" : undefined}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/events/bulk">まとめて作る</Link>
            </Button>
            <Button asChild size="sm" className="hidden md:inline-flex">
              <Link href="/events/new">＋ 現場を作る</Link>
            </Button>
          </>
        }
      />
      {!group && (
        <>
          <div className="mx-4 mb-2 flex gap-1 rounded-lg bg-muted p-1">
            <Link
              href={`/events${qs(filters, { view: undefined, month: undefined })}`}
              className={cn("flex h-11 flex-1 items-center justify-center gap-1 rounded-md", !calendar ? "bg-background font-bold shadow-sm" : "text-muted-foreground")}
            >
              <ListIcon className="size-4" />
              リスト
            </Link>
            <Link
              href={`/events${qs(filters, { view: "calendar", from: undefined, to: undefined, month: from.slice(0, 7) })}`}
              className={cn("flex h-11 flex-1 items-center justify-center gap-1 rounded-md", calendar ? "bg-background font-bold shadow-sm" : "text-muted-foreground")}
            >
              <CalendarIcon className="size-4" />
              カレンダー
            </Link>
          </div>
          <Suspense>
            <FilterBar
              basePath="/events"
              filters={[
                { name: "client", label: "取引先", options: clients.map((c) => ({ value: c.id, label: c.name })) },
                { name: "venue", label: "会場", options: venues.map((v) => ({ value: v.id, label: v.name })) },
                { name: "shortage", label: "欠員", allLabel: "欠員: すべて", options: [{ value: "1", label: "欠員ありだけ" }] },
                {
                  name: "status",
                  label: "ステータス",
                  options: Object.entries(EVENT_STATUS).map(([k, v]) => ({ value: k, label: v.label })),
                },
              ]}
            />
          </Suspense>
          <div className="flex items-center justify-between px-4 pb-2">
            <Button asChild variant="ghost" size="sm">
              <Link
                href={`/events${calendar ? qs(filters, { month: monthRange(addDays(`${month}-01`, -1).slice(0, 7)).start.slice(0, 7) }) : qs(filters, { from: addDays(from, -span), to: addDays(from, -1) })}`}
              >
                <ChevronLeftIcon />
                前
              </Link>
            </Button>
            <span className="font-medium">
              {calendar ? `${parse(`${month}-01`).y}年${parse(`${month}-01`).m}月` : `${formatShortJa(from)} 〜 ${formatShortJa(to)}`}
            </span>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/events${calendar ? qs(filters, { month: nextMonth(month) }) : qs(filters, { from: addDays(to, 1), to: addDays(to, span) })}`}>
                次
                <ChevronRightIcon />
              </Link>
            </Button>
          </div>
        </>
      )}

      {calendar ? (
        <MonthCalendar month={month} byDate={byDate} holidays={holidays} filters={filters} />
      ) : events.length === 0 ? (
        <EmptyState title="この期間の現場はありません" action={<Button asChild><Link href="/events/new">現場を作る</Link></Button>}>
          右下の ＋ か「まとめて作る」から作れます。
        </EmptyState>
      ) : (
        <div className="flex flex-col">
          {[...byDate.entries()].map(([date, list]) => {
            const wd = weekdayJa(date);
            return (
              <section key={date}>
                <h2
                  className={cn(
                    "sticky top-[61px] z-10 border-y bg-muted/90 px-4 py-1 text-sm font-bold backdrop-blur",
                    (wd === "日" || holidays[date]) && "text-status-alert",
                    wd === "土" && !holidays[date] && "text-primary",
                  )}
                >
                  {formatShortJa(date)} {holidays[date]}
                </h2>
                <ul className="divide-y">
                  {list.map((e) => (
                    <li key={e.id}>
                      <Link
                        href={`/events/${e.id}${qs(filters, {})}`}
                        className={cn("flex min-h-16 items-center gap-3 px-4 py-2 hover:bg-accent", e.id === selectedId && "bg-primary/10", e.cancelled_at && "opacity-60")}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{e.venue?.name}</span>
                          <span className="block truncate text-sm text-muted-foreground">
                            {[formatTimeRange(e.start_time, e.end_time), e.client?.name].filter(Boolean).join(" / ")}
                          </span>
                        </span>
                        <span className="flex flex-col items-end gap-1">
                          <StaffCount e={e} />
                          {!e.cancelled_at && ["done", "results_confirmed", "closed"].includes(e.status!) && (
                            <Badge tone={EVENT_STATUS[e.status!].tone}>{EVENT_STATUS[e.status!].label}</Badge>
                          )}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function MonthCalendar({
  month,
  byDate,
  holidays,
  filters,
}: {
  month: string;
  byDate: Map<string, EventListItem[]>;
  holidays: Record<string, string>;
  filters: EventFilters;
}) {
  const { start, end } = monthRange(month);
  const lead = "日月火水木金土".indexOf(weekdayJa(start));
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...eachDay(start, end)];
  return (
    <div className="px-4">
      <div className="grid grid-cols-7 gap-1 text-center text-sm">
        {"日月火水木金土".split("").map((w, i) => (
          <div key={w} className={cn(i === 0 && "text-status-alert", i === 6 && "text-primary")}>
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={`b${i}`} />;
          const list = (byDate.get(d) ?? []).filter((e) => !e.cancelled_at);
          const short = list.some((e) => e.shortage_total! > 0);
          const wd = i % 7;
          return (
            <Link
              key={d}
              href={`/events${qs({ ...filters, view: undefined, month: undefined }, { from: d, to: d })}`}
              title={holidays[d]}
              className={cn(
                "flex min-h-16 flex-col items-center gap-1 rounded-md border p-1 hover:bg-accent",
                list.length && (short ? "border-status-alert/40 bg-status-alert-bg" : "border-status-done/40 bg-status-done-bg"),
              )}
            >
              <span className={cn("text-xs", (wd === 0 || holidays[d]) && "text-status-alert", wd === 6 && !holidays[d] && "text-primary")}>
                {Number(d.slice(8))}
              </span>
              {list.length > 0 && <span className={cn("text-sm font-bold", short ? "text-status-alert" : "text-status-done")}>{list.length}件</span>}
            </Link>
          );
        })}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">赤 = 欠員あり、緑 = 人員確定。日付を押すとその日の現場が出ます。</p>
    </div>
  );
}
