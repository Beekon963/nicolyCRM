"use client";

import { AlertTriangleIcon, ChevronDownIcon, ChevronRightIcon, ListIcon, Table2Icon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SeatBar, ThinBar } from "@/components/app/seat-bar";
import { StatusPill } from "@/components/app/status-pill";
import { type Board, type BoardEventChip } from "@/lib/board";
import { type BoardFilters, isFree, sortChips } from "@/lib/board/view";
import { formatShortJa } from "@/lib/date";
import { fillOf } from "@/lib/fill";
import { cn } from "@/lib/utils";
import { venueStyle } from "@/lib/venue-colors";

export type BoardView = "list" | "table";

/** 絞り込みの切りかえボタン（押すと色が付く。件数つき） */
function Toggle({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors motion-safe:active:translate-y-px",
        on ? "border-primary bg-brand-50 text-primary" : "border-input bg-background text-[#344054] hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

const Count = ({ n, tone }: { n: number; tone: "alert" | "done" | "muted" }) => (
  <span
    className={cn(
      "min-w-6 rounded-full px-1.5 text-center text-xs leading-5 font-bold tabular-nums",
      tone === "alert" && (n > 0 ? "bg-status-alert-solid text-white" : "bg-muted text-muted-foreground"),
      tone === "done" && (n > 0 ? "bg-status-done-solid text-white" : "bg-muted text-muted-foreground"),
      tone === "muted" && "bg-muted text-[#344054]",
    )}
  >
    {n}
  </span>
);

/**
 * 稼働表の上の絞り込み（Phase 10）: 欠員の現場だけ・○で空いている人だけ・今日から。リストと表の切りかえ。
 * リストは今日から並び、○で空いている人も日ごとに出るので、リストのときは「欠員の現場だけ」だけ出す
 */
export function BoardFilterBar({
  filters,
  setFilters,
  counts,
  view,
  setView,
}: {
  filters: BoardFilters;
  setFilters: (f: BoardFilters) => void;
  counts: { shortage: number; free: number; past: number };
  view: BoardView;
  setView: (v: BoardView) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-2" role="group" aria-label="絞り込み">
      <Toggle on={filters.shortageOnly} label={`欠員の現場だけ ${counts.shortage}件`} onClick={() => setFilters({ ...filters, shortageOnly: !filters.shortageOnly })}>
        <AlertTriangleIcon aria-hidden className="size-4 text-status-alert" />
        {/* スマホは短く（ボタンが1〜2行に収まるように） */}
        <span className="max-md:hidden">欠員の現場だけ</span>
        <span className="md:hidden">欠員だけ</span>
        <Count n={counts.shortage} tone="alert" />
      </Toggle>
      {view === "table" && (
        <Toggle on={filters.freeOnly} label={`○で空いている人だけ ${counts.free}人`} onClick={() => setFilters({ ...filters, freeOnly: !filters.freeOnly })}>
          <b aria-hidden className="text-base leading-none text-status-done">○</b>
          <span className="max-md:hidden">で空いている人だけ</span>
          <span className="md:hidden">の人だけ</span>
          <Count n={counts.free} tone="done" />
        </Toggle>
      )}
      {view === "table" && counts.past > 0 && (
        <Toggle on={filters.fromToday} label={`今日から（過ぎた${counts.past}日を隠す）`} onClick={() => setFilters({ ...filters, fromToday: !filters.fromToday })}>
          今日から
          <span className="text-xs font-normal text-muted-foreground max-md:hidden">（過ぎた{counts.past}日を隠す）</span>
        </Toggle>
      )}
      <div className="ml-auto flex rounded-full border bg-muted p-0.5" role="group" aria-label="見せ方">
        {(
          [
            ["list", "リスト", ListIcon],
            ["table", "表", Table2Icon],
          ] as const
        ).map(([v, label, Icon]) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={cn(
              "inline-flex min-h-10 items-center gap-1 rounded-full px-3 text-sm font-semibold",
              view === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon aria-hidden className="size-4" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

type DayEvent = BoardEventChip & { clientId: string; clientName: string };

/**
 * スマホ向けの日ごとのリスト（Phase 10）。今日から1日ずつ、欠員の現場を上に並べる。
 * 現場を押すと現場の画面へ。その日○で空いている人を押すと、表のマスと同じ画面（打診・確定）が開く
 */
export function BoardDayList({ board, filters, onStaffDay }: { board: Board; filters: BoardFilters; onStaffDay: (staffId: string, date: string) => void }) {
  const todayIdx = board.days.findIndex((d) => d.isToday);
  const [showPast, setShowPast] = useState(false);
  const days = todayIdx > 0 && !showPast ? board.days.slice(todayIdx) : board.days;
  const items = days
    .map((d) => {
      const events: DayEvent[] = board.clients.flatMap((c) => sortChips(c.cells[d.date] ?? []).map((e) => ({ ...e, clientId: c.id, clientName: c.name })));
      // 欠員の現場 → そろった現場 → 中止
      const rank = (e: DayEvent) => (e.cancelled ? 2 : e.shortage > 0 ? 0 : 1);
      events.sort((a, b) => rank(a) - rank(b));
      const free = board.staff.filter((s) => isFree(s.cells[d.date]));
      return { d, events, free };
    })
    .filter((x) => !filters.shortageOnly || x.events.length > 0);
  // 現場のない日が続くところは1行にまとめる（今日は1日でも出す）
  type Item = (typeof items)[number];
  const blocks: ({ kind: "day"; item: Item } | { kind: "empty"; from: string; to: string })[] = [];
  for (const item of items) {
    const last = blocks.at(-1);
    if (item.events.length === 0 && !item.d.isToday) {
      if (last?.kind === "empty") last.to = item.d.date;
      else blocks.push({ kind: "empty", from: item.d.date, to: item.d.date });
    } else blocks.push({ kind: "day", item });
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-4" data-testid="board-day-list">
      {todayIdx > 0 && (
        <button type="button" className="inline-flex min-h-11 items-center gap-1 self-start text-sm font-semibold text-primary" onClick={() => setShowPast(!showPast)}>
          {showPast ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
          {showPast ? "過ぎた日を隠す" : `過ぎた日も見る（${todayIdx}日）`}
        </button>
      )}
      {items.length === 0 && (
        <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">
          {filters.shortageOnly ? "欠員の現場はありません ✓" : "この月の現場はまだありません。「現場」から現場を作ってください。"}
        </p>
      )}
      {blocks.map((b) => {
        if (b.kind === "empty")
          return (
            <p key={b.from} className="px-1 text-sm text-muted-foreground">
              {formatShortJa(b.from)}
              {b.to !== b.from && `〜${formatShortJa(b.to)}`}　現場なし
            </p>
          );
        const { d, events, free } = b.item;
        const fill = fillOf([d]);
        return (
          <section key={d.date} aria-label={formatShortJa(d.date)} className={cn("flex flex-col gap-2 rounded-2xl border bg-card p-3 shadow-card", d.isToday && "ring-2 ring-primary/40")}>
            <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className={cn("text-base font-bold", (d.weekday === "日" || d.holiday) && "text-status-alert", d.weekday === "土" && "text-primary")}>{formatShortJa(d.date)}</h3>
              {d.isToday && <span className="rounded-full bg-primary px-2 text-xs leading-5 font-bold text-primary-foreground">今日</span>}
              {d.holiday && <span className="text-xs text-status-alert">{d.holiday}</span>}
              <span className="ml-auto flex items-center gap-2 text-sm tabular-nums">
                {fill.required > 0 && (
                  <>
                    <ThinBar fill={fill} className="w-14" />
                    <span className="text-muted-foreground">
                      {fill.filled}/{fill.required}人
                    </span>
                    {d.shortage > 0 ? <StatusPill tone="alert">欠{d.shortage}</StatusPill> : <StatusPill tone="done">✓</StatusPill>}
                  </>
                )}
              </span>
            </header>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">現場はありません</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {events.map((e) => (
                  <li key={e.id}>
                    <EventRow e={e} free={free.length} />
                  </li>
                ))}
              </ul>
            )}
            {free.length > 0 && events.some((e) => !e.cancelled && e.shortage > 0) && (
              <details className="group rounded-xl bg-status-done-bg/60">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-semibold text-[#344054]">
                  <b className="text-status-done">○</b>この日○で空いている人（{free.length}人）
                  <ChevronDownIcon aria-hidden className="ml-auto size-4 transition-transform group-open:rotate-180" />
                </summary>
                <ul className="flex flex-wrap gap-1.5 px-3 pb-3">
                  {free.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => onStaffDay(s.id, d.date)}
                        className="inline-flex min-h-11 items-center gap-1 rounded-full border bg-background px-3 text-sm font-semibold hover:bg-accent"
                      >
                        {s.rankName && <span className="rounded border border-primary/30 px-1 text-xs text-primary">{s.rankName}</span>}
                        {s.name}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** リストの1現場（表の現場のマスと同じ見た目: 欠員は赤い地、そろったら会場の色に緑の ✓） */
function EventRow({ e, free }: { e: DayEvent; free: number }) {
  if (e.cancelled)
    return (
      <Link href={`/events/${e.id}`} className="flex min-h-11 items-center gap-2 rounded-xl border border-dashed px-3 py-2 text-muted-foreground">
        <span className="text-xs font-bold">中止</span>
        <span className="min-w-0 truncate line-through">{e.venueName}</span>
      </Link>
    );
  const short = e.shortage > 0;
  return (
    <Link
      href={`/events/${e.id}`}
      style={venueStyle(e.venueColor)}
      data-tile={short ? "shortage" : "filled"}
      className={cn(
        "flex min-h-11 flex-col gap-1 rounded-xl px-3 py-2 motion-safe:active:translate-y-px",
        short
          ? "bg-status-alert-tint text-[#912018] shadow-[inset_4px_0_0_var(--status-alert-solid)]"
          : "bg-(--v-tint) text-(--v-fg) shadow-[inset_4px_0_0_var(--v-bar)]",
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {short && <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full bg-(--v-bar) ring-2 ring-white" />}
        <span className="min-w-0 flex-1 truncate font-bold">{e.venueName}</span>
        <ChevronRightIcon aria-hidden className="size-4 shrink-0 opacity-60" />
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <SeatBar required={e.required} confirmed={e.confirmed} offered={e.offered} />
        <span className="text-sm font-semibold tabular-nums">
          {e.confirmed}/{e.required}人
        </span>
        {short ? <StatusPill tone="alert">欠{e.shortage}</StatusPill> : <StatusPill tone="done">✓</StatusPill>}
        {e.offered > 0 && <StatusPill tone="waiting">打{e.offered}</StatusPill>}
        {short && free > 0 && <span className="text-sm font-bold text-status-done">○{free}</span>}
        <span className="ml-auto min-w-0 truncate text-sm opacity-80">{e.clientName}</span>
      </span>
    </Link>
  );
}
