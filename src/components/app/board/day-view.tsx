"use client";

import {
  AlertTriangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CompanyName } from "@/components/app/company-name";
import { StatusPill } from "@/components/app/status-pill";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type Board,
  type BoardStaffAssignment,
  type BoardStaffRow,
  isDropped,
} from "@/lib/board";
import { chipLabel } from "@/lib/board/short-name";
import {
  type DayCard,
  eventsOfDay,
  filterDayCards,
  type StaffFilter,
  staffMatches,
  unassignedStaff,
} from "@/lib/board/views";
import { addDays, type DateString, formatShortJa } from "@/lib/date";
import type { BoardEventInfo } from "@/lib/data/board";
import { cn } from "@/lib/utils";
import { venueStyle } from "@/lib/venue-colors";

type Person = { row: BoardStaffRow; availability: "ok" | "maybe" };

/**
 * 日ビュー（Phase 22-3）: 1日ずつ見る。
 * - 上: 日付の帯（押して移動。欠員のある日は赤い点、そろった日は緑の点）と、その日の 配置／必要
 * - 赤い帯「現場未定 N人」: ○△を出しているのに、その日の現場が決まっていない人。押すと打診・確定の画面
 * - 現場ごとのカード: キャリア＋場所の短い名前、配置／必要（欠員は赤）、入っている人（確定 = 塗り、打診中・補欠 = 点線）。
 *   「空き」を押すと、その日○△の人から選べる
 */
export function DayView({
  board,
  date,
  setDate,
  slideCls,
  filter,
  events,
  roles,
  onStaff,
}: {
  board: Board;
  date: DateString;
  /** 日を変える（月の外の日なら、呼び出し元が前後の月を開く） */
  setDate: (d: DateString) => void;
  /** 日を切り替えたときの動き（横から入る）のクラス */
  slideCls?: string;
  filter: StaffFilter;
  /** 現場の時間・役割ごとの人数（data.events） */
  events: Record<string, BoardEventInfo>;
  roles: { id: string; name: string }[];
  /** 人を押した（eventId は「この現場に入れたい」とき） */
  onStaff: (staffId: string, date: DateString, eventId?: string) => void;
}) {
  const day = board.days.find((d) => d.date === date);
  const all = eventsOfDay(board, date);
  const cards = filterDayCards(all, filter);
  const people: Person[] = unassignedStaff(board, date).filter(({ row }) =>
    staffMatches(row, filter.query),
  );
  const [pick, setPick] = useState<DayCard | null>(null);
  const today = board.days.find((d) => d.isToday)?.date;
  const weekend = day && (day.weekday === "日" || day.holiday);

  return (
    <section
      data-testid="board-day"
      aria-label={`${formatShortJa(date)}の稼働`}
      className="flex flex-col gap-3 px-4 pb-4"
    >
      <DayStrip board={board} date={date} setDate={setDate} />

      <div key={date} className={cn("flex flex-col gap-3", slideCls)}>
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3
            className={cn(
              "text-lg font-bold",
              weekend && "text-status-alert",
              day?.weekday === "土" && "text-primary",
            )}
          >
            {formatShortJa(date)}
          </h3>
          {day?.isToday ? (
            <span className="rounded-full bg-primary px-2 text-xs leading-5 font-bold text-primary-foreground">
              今日
            </span>
          ) : (
            today && (
              <button
                type="button"
                className="min-h-11 text-sm font-semibold text-primary"
                onClick={() => setDate(today)}
              >
                今日へ
              </button>
            )
          )}
          {day?.holiday && (
            <span className="text-xs text-status-alert">{day.holiday}</span>
          )}
          <span
            className="ml-auto flex items-center gap-2 text-sm tabular-nums"
            data-testid="day-total"
          >
            {day && day.required > 0 ? (
              <>
                <span className="text-muted-foreground">
                  配置{" "}
                  <b
                    className={cn(
                      "text-base text-foreground",
                      day.shortage > 0 && "text-status-alert",
                    )}
                  >
                    {day.confirmed}
                  </b>
                  ／必要 {day.required}人
                </span>
                {day.shortage > 0 ? (
                  <StatusPill tone="alert">欠{day.shortage}</StatusPill>
                ) : (
                  <StatusPill tone="done">✓</StatusPill>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">現場なし</span>
            )}
          </span>
        </header>

        <UnassignedBand
          people={people}
          date={date}
          onStaff={onStaff}
          searching={!!filter.query.trim()}
        />

        {all.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-6 text-center text-muted-foreground">
            <p>この日の現場はありません</p>
            <Button asChild variant="outline">
              <Link href={`/events/new?date=${date}`}>この日に現場を作る</Link>
            </Button>
          </div>
        ) : cards.length === 0 ? (
          <p className="rounded-xl bg-muted p-3 text-center text-sm text-[#344054]">
            この絞り込みに合う現場はありません
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {cards.map((c) => (
              <li key={c.id}>
                <EventCard
                  card={c}
                  info={events[c.id]}
                  roles={roles}
                  date={date}
                  onStaff={onStaff}
                  onPick={setPick}
                />
              </li>
            ))}
          </ul>
        )}
        {all.length > 0 && (
          <Button asChild variant="ghost" className="self-start">
            <Link href={`/events/new?date=${date}`}>
              <PlusIcon />
              この日に現場を作る
            </Link>
          </Button>
        )}
      </div>

      <CandidatesDialog
        card={pick}
        date={date}
        people={unassignedStaff(board, date)}
        onClose={() => setPick(null)}
        onStaff={onStaff}
      />
    </section>
  );
}

/** 日付の帯: 月の日を横に並べる（選んだ日は青、今日は枠、欠員のある日は赤い点、そろった日は緑の点）。前の日・次の日は月の外にも進める（前後の月を開く） */
function DayStrip({
  board,
  date,
  setDate,
}: {
  board: Board;
  date: DateString;
  setDate: (d: DateString) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 選んだ日が真ん中あたりに来るように、帯の中だけ横に動かす（ページは動かさない）
    const box = ref.current;
    const el = box?.querySelector<HTMLElement>(`[data-date="${date}"]`);
    if (!box || !el) return;
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    box.scrollTo({
      left: el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2,
      behavior: reduce ? "auto" : "smooth",
    });
  }, [date]);
  return (
    <div className="flex items-center gap-1" data-testid="day-strip">
      <Button
        variant="ghost"
        size="icon"
        aria-label="前の日"
        onClick={() => setDate(addDays(date, -1))}
      >
        <ChevronLeftIcon />
      </Button>
      <div
        ref={ref}
        role="group"
        aria-label="日を選ぶ"
        className="relative flex min-w-0 flex-1 gap-1 overflow-x-auto py-1 [scrollbar-width:none]"
      >
        {board.days.map((d) => {
          const on = d.date === date;
          const tone =
            d.required === 0 ? null : d.shortage > 0 ? "alert" : "done";
          const wd =
            d.holiday || d.weekday === "日"
              ? "text-status-alert"
              : d.weekday === "土"
                ? "text-primary"
                : "text-muted-foreground";
          return (
            <button
              key={d.date}
              type="button"
              data-date={d.date}
              aria-pressed={on}
              aria-label={`${formatShortJa(d.date)}${d.isToday ? " 今日" : ""}${tone === "alert" ? ` 欠${d.shortage}` : ""}`}
              onClick={() => setDate(d.date)}
              className={cn(
                "flex h-14 w-11 shrink-0 flex-col items-center justify-center rounded-xl text-sm transition-colors motion-safe:active:translate-y-px",
                on
                  ? "bg-primary text-primary-foreground shadow-card"
                  : "hover:bg-accent",
                d.isToday && !on && "ring-2 ring-primary/40",
              )}
            >
              <span
                className={cn(
                  "text-xs leading-4",
                  on ? "text-primary-foreground/80" : wd,
                )}
              >
                {d.weekday}
              </span>
              <span className="text-base leading-5 font-bold tabular-nums">
                {d.day}
              </span>
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 size-1.5 rounded-full",
                  tone === "alert"
                    ? on
                      ? "bg-white"
                      : "bg-status-alert-solid"
                    : tone === "done"
                      ? on
                        ? "bg-white/70"
                        : "bg-status-done-solid"
                      : "bg-transparent",
                )}
              />
            </button>
          );
        })}
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label="次の日"
        onClick={() => setDate(addDays(date, 1))}
      >
        <ChevronRightIcon />
      </Button>
    </div>
  );
}

const LIMIT = 8;

/** 赤い帯「現場未定 N人」。○の人が先、△はあと。多いときは8人まで出して「ほか N人を見る」 */
function UnassignedBand({
  people,
  date,
  onStaff,
  searching,
}: {
  people: Person[];
  date: DateString;
  onStaff: (staffId: string, date: DateString) => void;
  searching: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (people.length === 0)
    return (
      <p
        className="flex min-h-11 items-center gap-2 rounded-xl bg-status-done-bg px-3 text-sm font-semibold text-status-done"
        data-testid="unassigned-band"
        data-count="0"
      >
        ✓ 現場未定の人はいません{searching && "（この名前では）"}
      </p>
    );
  const shown = open ? people : people.slice(0, LIMIT);
  const ok = people.filter((p) => p.availability === "ok").length;
  return (
    <section
      data-testid="unassigned-band"
      data-count={people.length}
      aria-label={`現場未定 ${people.length}人`}
      className="flex flex-col gap-2 rounded-xl border-l-4 border-status-alert-solid bg-status-alert-bg p-3"
    >
      <h4 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold text-status-alert">
        <AlertTriangleIcon aria-hidden className="size-4 shrink-0" />
        現場未定
        <span className="rounded-full bg-status-alert-solid px-2 leading-5 text-white tabular-nums">
          {people.length}人
        </span>
        <span className="font-normal text-muted-foreground">
          ○{ok}・△{people.length - ok}。押すと打診・確定
        </span>
      </h4>
      <ul className="flex flex-wrap gap-1.5">
        {shown.map((p) => (
          <li key={p.row.id}>
            <PersonPill p={p} onClick={() => onStaff(p.row.id, date)} />
          </li>
        ))}
      </ul>
      {people.length > LIMIT && (
        <button
          type="button"
          className="min-h-11 self-start text-sm font-semibold text-primary"
          onClick={() => setOpen(!open)}
        >
          {open ? "たたむ" : `ほか ${people.length - LIMIT}人を見る`}
        </button>
      )}
    </section>
  );
}

/** 現場未定の人の札（○△・名前・ランク） */
function PersonPill({ p, onClick }: { p: Person; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border border-status-alert-border bg-background px-3 text-sm font-semibold hover:bg-accent motion-safe:active:translate-y-px"
    >
      <b
        className={
          p.availability === "ok" ? "text-status-done" : "text-status-waiting"
        }
      >
        {p.availability === "ok" ? "○" : "△"}
      </b>
      <span className="truncate">{p.row.name}</span>
      {p.row.rankName && (
        <span className="shrink-0 rounded border border-primary/30 px-1 text-xs font-normal text-primary">
          {p.row.rankName}
        </span>
      )}
    </button>
  );
}

const hm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

/** 現場のカード。欠員は薄い赤の地、中止は点線。左の線とチップは会場の色 */
function EventCard({
  card,
  info,
  roles,
  date,
  onStaff,
  onPick,
}: {
  card: DayCard;
  info: BoardEventInfo | undefined;
  roles: { id: string; name: string }[];
  date: DateString;
  onStaff: (staffId: string, date: DateString, eventId?: string) => void;
  onPick: (card: DayCard) => void;
}) {
  const short = !card.cancelled && card.shortage > 0;
  const time =
    info?.message.start_time && info.message.end_time
      ? `${hm(info.message.start_time)}〜${hm(info.message.end_time)}`
      : "";
  // 役割が2つ以上あるときは役割ごとに分けて出す
  const byRole = Object.entries(info?.byRole ?? {}).filter(
    ([, r]) => r.required > 0,
  );
  const groups =
    byRole.length > 1
      ? byRole.map(([id, r]) => ({
          id,
          name: roles.find((x) => x.id === id)?.name ?? "",
          r,
          staff: card.staff.filter((s) => s.a.roleId === id),
        }))
      : [
          {
            id: "",
            name: "",
            r: {
              required: card.required,
              confirmed: card.confirmed,
              shortage: card.shortage,
            },
            staff: card.staff,
          },
        ];
  return (
    <article
      data-card={card.cancelled ? "cancelled" : short ? "shortage" : "filled"}
      data-event={card.id}
      style={venueStyle(card.venueColor)}
      className={cn(
        "flex flex-col gap-2 rounded-2xl border border-l-4 border-l-(--v-solid) bg-card p-3 shadow-card",
        short && "border-status-alert-border bg-status-alert-bg",
        card.cancelled && "border-dashed",
      )}
    >
      <header className="flex items-start gap-2">
        <Link
          href={`/events/${card.id}`}
          className="flex min-w-0 flex-1 flex-col gap-0.5"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="inline-flex h-6 shrink-0 items-center rounded-md bg-(--v-solid) px-1.5 text-xs font-bold whitespace-nowrap text-(--v-on)">
              {chipLabel(card)}
            </span>
            <span
              className={cn(
                "min-w-0 truncate font-bold",
                card.cancelled && "text-muted-foreground line-through",
              )}
            >
              {card.venueName}
            </span>
            <ChevronRightIcon
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
          </span>
          <span className="truncate text-sm text-muted-foreground">
            <CompanyName name={card.clientName} />
            {time && <span className="ml-2 tabular-nums">{time}</span>}
          </span>
        </Link>
        <span className="flex shrink-0 flex-col items-end gap-1 text-sm tabular-nums">
          {card.cancelled ? (
            <span className="rounded-full bg-muted px-2 text-xs leading-5 font-bold text-muted-foreground">
              中止
            </span>
          ) : (
            <>
              <span
                className={cn("font-semibold", short && "text-status-alert")}
              >
                {card.confirmed}/{card.required}人
              </span>
              <span className="flex gap-1">
                {short ? (
                  <StatusPill tone="alert">欠{card.shortage}</StatusPill>
                ) : (
                  <StatusPill tone="done">✓</StatusPill>
                )}
                {card.offered > 0 && (
                  <StatusPill tone="waiting">打{card.offered}</StatusPill>
                )}
              </span>
            </>
          )}
        </span>
      </header>
      {!card.cancelled &&
        groups.map((g) => {
          // 打診中の人は席を1つ使っていると見て、「空き」はその分を引く（人数分のマスと同じ数え方）
          const offered = g.staff.filter(
            (s) => s.a.status === "offered",
          ).length;
          const empty = Math.max(0, g.r.shortage - offered);
          return (
            <div key={g.id} className="flex flex-wrap items-center gap-1.5">
              {g.name && (
                <span className="mr-1 text-xs font-semibold text-muted-foreground tabular-nums">
                  {g.name} {g.r.confirmed}/{g.r.required}
                </span>
              )}
              {g.staff.map(({ row, a }) => (
                <NameChip
                  key={a.id}
                  row={row}
                  a={a}
                  onClick={() => onStaff(row.id, date, card.id)}
                />
              ))}
              {Array.from({ length: empty }, (_, k) => (
                <button
                  key={`empty-${k}`}
                  type="button"
                  onClick={() => onPick(card)}
                  aria-label={`${chipLabel(card)}の空きに人を入れる`}
                  className="inline-flex min-h-11 items-center gap-1 rounded-full border-2 border-dashed border-status-alert-border bg-background px-3 text-sm font-semibold text-status-alert hover:bg-status-alert-tint motion-safe:active:translate-y-px"
                >
                  <PlusIcon aria-hidden className="size-4" />
                  空き
                </button>
              ))}
              {g.staff.length === 0 && empty === 0 && (
                <span className="text-sm text-muted-foreground">
                  入っている人はいません
                </span>
              )}
            </div>
          );
        })}
    </article>
  );
}

/** 入っている人の札: 確定 = 会場の色で塗る、打診中・補欠 = 点線（「打」「補」）、キャンセル・当日不稼働 = 赤い枠に ✕ */
function NameChip({
  row,
  a,
  onClick,
}: {
  row: BoardStaffRow;
  a: BoardStaffAssignment;
  onClick: () => void;
}) {
  const base =
    "inline-flex min-h-11 max-w-full items-center gap-1 rounded-full px-3 text-sm font-semibold motion-safe:active:translate-y-px";
  if (isDropped(a.status))
    return (
      <button
        type="button"
        onClick={onClick}
        data-name-chip="dropped"
        className={cn(
          base,
          "border-2 border-status-alert-solid bg-status-alert-bg text-status-alert",
        )}
      >
        <XIcon aria-hidden className="size-3.5 shrink-0" strokeWidth={3} />
        <span className="truncate line-through">{row.name}</span>
        <span className="text-xs font-normal">
          {a.status === "cancelled" ? "キャンセル" : "当日不稼働"}
        </span>
      </button>
    );
  if (a.status === "confirmed")
    return (
      <button
        type="button"
        onClick={onClick}
        data-name-chip="confirmed"
        className={cn(base, "bg-(--v-solid) text-(--v-on) hover:opacity-90")}
      >
        <span className="truncate">{row.name}</span>
      </button>
    );
  return (
    <button
      type="button"
      onClick={onClick}
      data-name-chip="tentative"
      className={cn(
        base,
        "border-2 border-dashed border-(--v-solid) bg-background text-(--v-fg) hover:bg-accent",
      )}
    >
      <span className="shrink-0 rounded-sm bg-(--v-tint) px-1 text-[10px] leading-4">
        {a.status === "offered" ? "打" : "補"}
      </span>
      <span className="truncate">{row.name}</span>
    </button>
  );
}

/** 「空き」を押したとき: その日○△で現場が決まっていない人から選ぶ（名前を押すと、その人の打診・確定の画面） */
function CandidatesDialog({
  card,
  date,
  people,
  onClose,
  onStaff,
}: {
  card: DayCard | null;
  date: DateString;
  people: Person[];
  onClose: () => void;
  onStaff: (staffId: string, date: DateString, eventId?: string) => void;
}) {
  return (
    <Dialog open={!!card} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        side="bottom"
        className="max-h-[85dvh] overflow-y-auto md:top-1/2 md:bottom-auto md:left-1/2 md:max-w-xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg"
      >
        {card && (
          <>
            <DialogHeader>
              <DialogTitle>
                {chipLabel(card)}・{formatShortJa(date)} に入れる人
              </DialogTitle>
              <DialogDescription>
                {card.venueName}（{card.clientName}
                ）。この日○△で、まだ現場が決まっていない人です。名前を押すと打診・確定の画面が開きます。
              </DialogDescription>
            </DialogHeader>
            {people.length === 0 ? (
              <p className="text-muted-foreground">
                この日○△の人はいません。「稼働可能日の提出状況」から提出をお願いするか、現場の画面から探してください。
              </p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {people.map((p) => (
                  <li key={p.row.id}>
                    <PersonPill
                      p={p}
                      onClick={() => {
                        onClose();
                        onStaff(p.row.id, date, card.id);
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
            <Button asChild variant="outline">
              <Link href={`/events/${card.id}`}>現場の画面で選ぶ</Link>
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
