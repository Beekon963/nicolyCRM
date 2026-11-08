"use client";

import { useRef } from "react";
import { StatusPill } from "@/components/app/status-pill";
import { type Board, type BoardStaffRow } from "@/lib/board";
import { chipsOf, dayOf, dayTotal, isPadDay } from "@/lib/board/views";
import { type DateString, weekdayJa } from "@/lib/date";
import { cn } from "@/lib/utils";
import { StaffChip } from "./staff-chip";

/**
 * 週ビュー（Phase 22）: 行 = スタッフ、列 = 7日。
 * ページはふつうに縦に動き、日付の行（上）と配置／必要の行（下）は画面に残る（スマホの上の帯・下のメニューの分だけ空ける）。
 * 横は表の中だけ動く。上下の行は、本体と同じ列幅の表を重ねて、横の動きをそろえる。名前の列は左に固定。
 * 月をまたぐ週は、月の前後の日（Board.pad）を薄い文字で出す。マスを押すと下からのシート（打診・確定・×）
 */
const TABLE =
  "w-full min-w-[49rem] table-fixed border-separate border-spacing-0 text-sm";
const NAME =
  "sticky left-0 z-10 bg-background shadow-[4px_0_6px_-4px_rgb(16_24_40/0.14)]";

export function WeekGrid({
  board,
  dates,
  rows,
  onCell,
}: {
  board: Board;
  dates: DateString[];
  rows: BoardStaffRow[];
  onCell: (staffId: string, date: DateString) => void;
}) {
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
      <col className="w-28" />
      {dates.map((d) => (
        <col key={d} className="w-24" />
      ))}
    </colgroup>
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

  return (
    <div className="mx-4" data-testid="board-week">
      {/* 日付の行（画面の上に残る。スマホは上の帯の下） */}
      <div
        ref={headRef}
        className="sticky top-[3.75rem] z-20 overflow-hidden rounded-t-xl border bg-background"
      >
        <table className={TABLE}>
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
                return (
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
            </tr>
          </thead>
        </table>
      </div>

      {/* 本体（横は表の中だけ動く） */}
      <div onScroll={sync} className="overflow-x-auto border-x bg-background">
        <table className={TABLE}>
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
                        aria-label={`${row.name} ${Number(date.slice(5, 7))}/${Number(date.slice(8))}`}
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
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={dates.length + 1}
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
        <table className={TABLE}>
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
                      className="p-2 text-center text-muted-foreground"
                    >
                      —
                    </td>
                  );
                return (
                  <td
                    key={date}
                    className={cn(
                      "p-2 text-center font-semibold tabular-nums",
                      t.shortage > 0 ? "text-status-alert" : "text-status-done",
                    )}
                    data-testid="week-total"
                    data-date={date}
                  >
                    {t.confirmed}/{t.required}
                    {t.shortage > 0 ? (
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
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
