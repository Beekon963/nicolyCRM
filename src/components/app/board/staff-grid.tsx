"use client";

import { XIcon } from "lucide-react";
import { useRef } from "react";
import { StatusPill } from "@/components/app/status-pill";
import { type Board, type BoardStaffRow } from "@/lib/board";
import {
  type ChipState,
  chipsOf,
  dayOf,
  dayTotal,
  isPadDay,
} from "@/lib/board/views";
import { type DateString, weekdayJa } from "@/lib/date";
import { cn } from "@/lib/utils";
import { venueStyle } from "@/lib/venue-colors";
import { StaffChip } from "./staff-chip";

type Props = {
  board: Board;
  dates: DateString[];
  rows: BoardStaffRow[];
  onCell: (staffId: string, date: DateString) => void;
};

/** 週ビュー（Phase 22-4）: 行 = スタッフ、列 = 7日。マスはチップ（確定・仮・現場未定） */
export function WeekGrid(props: Props) {
  return <StaffGrid {...props} mode="week" />;
}

/** 月ビュー（Phase 22-5）: 行 = スタッフ、列 = 月の日。マスは小さな印（ヒートマップ）、右端にその月の確定の稼働日数 */
export function MonthGrid(props: Props) {
  return <StaffGrid {...props} mode="month" />;
}

const NAME =
  "sticky left-0 z-10 bg-background shadow-[4px_0_6px_-4px_rgb(16_24_40/0.14)]";
const TOTAL =
  "sticky right-0 z-10 bg-background shadow-[-4px_0_6px_-4px_rgb(16_24_40/0.14)]";

/**
 * スタッフ × 日付の表（週・月で共通）。
 * ページはふつうに縦に動き、日付の行（上）と配置／必要の行（下）は画面に残る（スマホの上の帯・下のメニューの分だけ空ける）。
 * 横は表の中だけ動く。上下の行は、本体と同じ列幅の表を重ねて、横の動きをそろえる。名前の列は左に、月の稼働日数は右に固定。
 * 月をまたぐ週は、月の前後の日（Board.pad）を薄い文字で出す。マスを押すと下からのシート（打診・確定・×）
 */
function StaffGrid({
  board,
  dates,
  rows,
  onCell,
  mode,
}: Props & { mode: "week" | "month" }) {
  const month = mode === "month";
  const headRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  // 本体を横に動かしたら、上の日付の行と下の配置／必要の行も同じだけ動かす
  const sync = (e: React.UIEvent<HTMLDivElement>) => {
    const x = e.currentTarget.scrollLeft;
    if (headRef.current) headRef.current.scrollLeft = x;
    if (footRef.current) footRef.current.scrollLeft = x;
  };
  const cols = (
    <colgroup>
      <col className={month ? "w-20" : "w-28"} />
      {dates.map((d) => (
        <col key={d} className={month ? "w-[1.375rem]" : "w-24"} />
      ))}
      {month && <col className="w-12" />}
    </colgroup>
  );
  const table = cn(
    "w-full table-fixed border-separate border-spacing-0",
    month ? "text-xs" : "min-w-[49rem] text-sm",
  );
  const info = (date: DateString) => {
    const d = dayOf(board, date);
    const wd = weekdayJa(date);
    const pad = isPadDay(board, date);
    const tone =
      !d || pad
        ? "text-muted-foreground"
        : d.holiday || wd === "日"
          ? "text-status-alert"
          : wd === "土"
            ? "text-primary"
            : "text-foreground";
    return { d, wd, pad, tone };
  };
  const label = (row: BoardStaffRow, date: DateString) =>
    `${row.name} ${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;

  return (
    <div className="mx-4" data-testid={month ? "board-month" : "board-week"}>
      {/* 日付の行（画面の上に残る。スマホは上の帯の下） */}
      <div
        ref={headRef}
        className="sticky top-[3.75rem] z-20 overflow-hidden rounded-t-xl border bg-background"
      >
        <table className={table}>
          {cols}
          <thead>
            <tr>
              <th
                scope="col"
                className={cn(
                  NAME,
                  "p-2 text-left text-xs font-semibold text-muted-foreground",
                )}
              >
                名前
              </th>
              {dates.map((date) => {
                const { d, wd, pad, tone } = info(date);
                return month ? (
                  <th
                    key={date}
                    scope="col"
                    className={cn(
                      "px-0 py-1 text-center align-bottom font-semibold",
                      tone,
                      d?.isToday && "bg-brand-50",
                    )}
                    data-today={d?.isToday ? "1" : undefined}
                  >
                    <span className="block text-xs leading-4 tabular-nums">
                      {Number(date.slice(8))}
                    </span>
                    <span className="block text-[10px] leading-3 font-normal">
                      {wd}
                    </span>
                  </th>
                ) : (
                  <th
                    key={date}
                    scope="col"
                    className={cn(
                      "p-1 text-center align-bottom font-semibold",
                      tone,
                      d?.isToday && "bg-brand-50",
                    )}
                    data-today={d?.isToday ? "1" : undefined}
                    data-pad={pad ? "1" : undefined}
                  >
                    <span className="block text-lg leading-6 tabular-nums">
                      {pad && (
                        <span className="text-xs font-normal">
                          {Number(date.slice(5, 7))}/
                        </span>
                      )}
                      {Number(date.slice(8))}
                    </span>
                    <span className="block text-xs leading-4">
                      {wd}
                      {d?.holiday && "・祝"}
                      {!d && "（範囲外）"}
                    </span>
                    {d?.isToday && (
                      <span className="mx-auto mt-0.5 block w-fit rounded-full bg-primary px-1.5 text-[10px] leading-4 font-bold text-primary-foreground">
                        今日
                      </span>
                    )}
                  </th>
                );
              })}
              {month && (
                <th
                  scope="col"
                  className={cn(
                    TOTAL,
                    "p-1 text-center text-xs font-semibold text-muted-foreground",
                  )}
                >
                  稼働
                </th>
              )}
            </tr>
          </thead>
        </table>
      </div>

      {/* 本体（横は表の中だけ動く） */}
      <div onScroll={sync} className="overflow-x-auto border-x bg-background">
        <table className={table}>
          {cols}
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th
                  scope="row"
                  className={cn(
                    NAME,
                    "border-b p-2 text-left align-top font-semibold",
                  )}
                >
                  <span className="block truncate">{row.name}</span>
                  {row.rankName && (
                    <span className="block text-xs font-normal text-muted-foreground">
                      {row.rankName}
                    </span>
                  )}
                </th>
                {dates.map((date) => {
                  const { d, pad } = info(date);
                  if (!d)
                    return (
                      <td
                        key={date}
                        className="border-b p-1 text-center align-top text-muted-foreground"
                      >
                        —
                      </td>
                    );
                  const chips = chipsOf(row.cells[date]).filter(
                    (c) => c.kind !== "empty" && c.kind !== "off",
                  );
                  if (month)
                    return (
                      <td
                        key={date}
                        className={cn(
                          "border-b p-0 text-center align-middle",
                          d.isToday && "bg-brand-50/60",
                        )}
                      >
                        <button
                          type="button"
                          aria-label={label(row, date)}
                          onClick={() => onCell(row.id, date)}
                          className="flex h-11 w-full items-center justify-center hover:bg-accent motion-safe:active:translate-y-px"
                        >
                          {chips[0] && (
                            <MonthMark
                              state={chips[0]}
                              more={chips.length - 1}
                            />
                          )}
                        </button>
                      </td>
                    );
                  return (
                    <td
                      key={date}
                      className={cn(
                        "border-b p-1 align-top",
                        d.isToday && "bg-brand-50/60",
                        pad && "bg-muted/40",
                      )}
                    >
                      <button
                        type="button"
                        aria-label={label(row, date)}
                        onClick={() => onCell(row.id, date)}
                        className="flex min-h-11 w-full flex-col items-stretch gap-1 rounded-lg p-1 text-left hover:bg-accent motion-safe:active:translate-y-px"
                      >
                        {chips.map((c, i) => (
                          <StaffChip key={i} state={c} />
                        ))}
                      </button>
                    </td>
                  );
                })}
                {month && (
                  <td
                    className={cn(
                      TOTAL,
                      "border-b p-1 text-center font-bold tabular-nums",
                    )}
                    data-testid="month-worked"
                  >
                    {row.workedDays}
                    <span className="text-[10px] font-normal text-muted-foreground">
                      日
                    </span>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={dates.length + (month ? 2 : 1)}
                  className="p-6 text-center text-muted-foreground"
                >
                  この条件に合う人はいません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 配置／必要の行（画面の下に残る。スマホは下のメニューの上） */}
      <div
        ref={footRef}
        className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 overflow-hidden rounded-b-xl border bg-background md:bottom-0"
      >
        <table className={table}>
          {cols}
          <tfoot>
            <tr>
              <th
                scope="row"
                className={cn(
                  NAME,
                  "p-2 text-left text-xs font-semibold text-muted-foreground",
                )}
              >
                配置／必要
              </th>
              {dates.map((date) => {
                const t = dayTotal(board, date);
                if (!t || t.required === 0)
                  return (
                    <td
                      key={date}
                      className={cn(
                        "text-center text-muted-foreground",
                        month ? "p-0 text-[10px]" : "p-2",
                      )}
                    >
                      —
                    </td>
                  );
                const short = t.shortage > 0;
                if (month)
                  return (
                    <td
                      key={date}
                      role="img"
                      aria-label={`配置${t.confirmed}／必要${t.required}${short ? `（欠${t.shortage}）` : ""}`}
                      data-testid="month-total"
                      data-date={date}
                      className={cn(
                        "px-0 py-1 text-center text-[10px] leading-3 font-semibold tabular-nums",
                        short ? "text-status-alert" : "text-status-done",
                      )}
                    >
                      <span className="block">{t.confirmed}</span>
                      <span className="mx-auto block w-4 border-t border-current/50">
                        {t.required}
                      </span>
                    </td>
                  );
                return (
                  <td
                    key={date}
                    className={cn(
                      "p-2 text-center font-semibold tabular-nums",
                      short ? "text-status-alert" : "text-status-done",
                    )}
                    data-testid="week-total"
                    data-date={date}
                  >
                    {t.confirmed}/{t.required}
                    {short ? (
                      <StatusPill tone="alert" className="ml-1">
                        欠{t.shortage}
                      </StatusPill>
                    ) : (
                      <StatusPill tone="done" className="ml-1">
                        ✓
                      </StatusPill>
                    )}
                  </td>
                );
              })}
              {month && (
                <td
                  className={cn(
                    TOTAL,
                    "p-1 text-center text-xs font-bold tabular-nums",
                  )}
                  title="この月の確定の稼働日数の合計"
                >
                  {board.totals.workedDays}
                  <span className="text-[10px] font-normal text-muted-foreground">
                    日
                  </span>
                </td>
              )}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** 月ビューのマスの印: 確定 = 会場の色で塗る、仮 = 点線に「打」「補」、現場未定 = ○△、キャンセル = 赤い枠に ✕ */
function MonthMark({ state, more }: { state: ChipState; more: number }) {
  const base =
    "relative flex size-5 items-center justify-center rounded-[5px] text-[10px] leading-none font-bold";
  const plus = more > 0 && (
    <span
      aria-hidden
      className="absolute -top-1 -right-1 size-2 rounded-full bg-foreground ring-2 ring-background"
      title={`ほか${more}件`}
    />
  );
  if (state.kind === "confirmed")
    return (
      <span
        data-chip="confirmed"
        data-venue={state.a.venueId}
        style={venueStyle(state.a.venueColor)}
        title={`確定: ${state.a.venueName}（${state.a.clientName}）`}
        className={cn(base, "bg-(--v-solid)")}
      >
        {plus}
      </span>
    );
  if (state.kind === "tentative")
    return (
      <span
        data-chip="tentative"
        data-venue={state.a.venueId}
        style={venueStyle(state.a.venueColor)}
        title={`${state.a.status === "offered" ? "打診中" : "補欠"}: ${state.a.venueName}（${state.a.clientName}）`}
        className={cn(
          base,
          "border-2 border-dashed border-(--v-solid) bg-background text-(--v-fg)",
        )}
      >
        {state.a.status === "offered" ? "打" : "補"}
        {plus}
      </span>
    );
  if (state.kind === "dropped")
    return (
      <span
        data-chip="dropped"
        data-venue={state.a.venueId}
        title={`${state.a.status === "cancelled" ? "キャンセル" : "当日不稼働"}: ${state.a.venueName}`}
        className={cn(
          base,
          "border-2 border-status-alert-solid bg-status-alert-bg text-status-alert",
        )}
      >
        <XIcon aria-hidden className="size-3" strokeWidth={3} />
        {plus}
      </span>
    );
  if (state.kind === "unassigned")
    return (
      <span
        data-chip="unassigned"
        data-avail={state.availability}
        title={
          state.availability === "ok"
            ? "○（出られる）で現場が決まっていない"
            : "△（調整すれば可）で現場が決まっていない"
        }
        className={cn(
          base,
          "bg-status-waiting-bg text-status-waiting ring-1 ring-status-waiting-solid ring-inset",
        )}
      >
        {state.availability === "ok" ? "○" : "△"}
      </span>
    );
  return null;
}

/** 月ビューの凡例 */
export function MonthLegend() {
  const item = "inline-flex items-center gap-1.5 whitespace-nowrap";
  const a = {
    id: "x",
    eventId: "x",
    roleId: "x",
    venueId: "x",
    venueName: "会場名",
    venueColor: "blue",
    venueShort: "",
    carrier: "",
    clientName: "取引先",
    status: "confirmed" as const,
  };
  return (
    <div
      className="mx-4 my-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border bg-[#fcfcfd] p-3 text-sm text-muted-foreground"
      aria-label="マスの見方"
    >
      <span className={item}>
        <MonthMark state={{ kind: "confirmed", a }} more={0} />
        確定（会場の色）
      </span>
      <span className={item}>
        <MonthMark
          state={{
            kind: "tentative",
            a: { ...a, venueColor: "purple", status: "offered" },
          }}
          more={0}
        />
        仮（打診中・補欠）
      </span>
      <span className={item}>
        <MonthMark
          state={{ kind: "unassigned", availability: "ok" }}
          more={0}
        />
        ○△で現場が決まっていない
      </span>
      <span className={item}>
        <MonthMark
          state={{ kind: "dropped", a: { ...a, status: "cancelled" } }}
          more={0}
        />
        キャンセル・当日不稼働
      </span>
      <span>空白 = ×か未入力</span>
      <span>右端 = その月の確定の稼働日数</span>
      <span>最下行 = 上が配置・下が必要（赤 = 足りない）</span>
    </div>
  );
}
