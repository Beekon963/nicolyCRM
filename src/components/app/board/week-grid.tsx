"use client";

import { StatusPill } from "@/components/app/status-pill";
import { type Board, type BoardStaffRow } from "@/lib/board";
import { chipsOf, dayTotal } from "@/lib/board/views";
import { type DateString, weekdayJa } from "@/lib/date";
import { cn } from "@/lib/utils";
import { StaffChip } from "./staff-chip";

/**
 * 週ビュー（Phase 22）: 行 = スタッフ、列 = 7日。名前の列は固定、今日の列を薄く強調。
 * 最下行に 配置／必要（不足は赤）。スマホは表の中だけ横に動く。マスを押すと下からのシート（打診・確定・×）
 */
export function WeekGrid({ board, dates, rows, onCell }: { board: Board; dates: DateString[]; rows: BoardStaffRow[]; onCell: (staffId: string, date: DateString) => void }) {
  const dayOf = new Map(board.days.map((d) => [d.date, d]));
  const head = (date: DateString) => {
    const d = dayOf.get(date);
    const wd = weekdayJa(date);
    const off = !d;
    const tone = off ? "text-muted-foreground" : d.holiday || wd === "日" ? "text-status-alert" : wd === "土" ? "text-primary" : "text-foreground";
    return { d, wd, off, tone };
  };
  return (
    <div className="overflow-x-auto px-4 pb-2" data-testid="board-week">
      <table className="w-full min-w-[49rem] border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 w-28 min-w-28 bg-background p-2 text-left text-xs font-semibold text-muted-foreground">
              名前
            </th>
            {dates.map((date) => {
              const { d, wd, off, tone } = head(date);
              return (
                <th key={date} scope="col" className={cn("min-w-[6rem] p-1 text-center align-bottom font-semibold", tone, d?.isToday && "rounded-t-lg bg-brand-50")} data-today={d?.isToday ? "1" : undefined}>
                  <span className="block text-lg leading-6 tabular-nums">{Number(date.slice(8))}</span>
                  <span className="block text-xs leading-4">
                    {wd}
                    {d?.holiday && "・祝"}
                    {off && "（別の月）"}
                  </span>
                  {d?.isToday && <span className="mx-auto mt-0.5 block w-fit rounded-full bg-primary px-1.5 text-[10px] leading-4 font-bold text-primary-foreground">今日</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t">
              <th scope="row" className="sticky left-0 z-10 bg-background p-2 text-left align-top font-semibold">
                <span className="block truncate">{row.name}</span>
                {row.rankName && <span className="block text-xs font-normal text-muted-foreground">{row.rankName}</span>}
              </th>
              {dates.map((date) => {
                const { d, off } = head(date);
                if (off)
                  return (
                    <td key={date} className="border-t p-1 text-center align-top text-muted-foreground">
                      —
                    </td>
                  );
                const chips = chipsOf(row.cells[date]).filter((c) => c.kind !== "empty" && c.kind !== "off");
                return (
                  <td key={date} className={cn("border-t p-1 align-top", d?.isToday && "bg-brand-50/60")}>
                    <button type="button" aria-label={`${row.name} ${Number(date.slice(5, 7))}/${Number(date.slice(8))}`} onClick={() => onCell(row.id, date)} className="flex min-h-11 w-full flex-col items-stretch gap-1 rounded-lg p-1 text-left hover:bg-accent motion-safe:active:translate-y-px">
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
              <td colSpan={dates.length + 1} className="p-6 text-center text-muted-foreground">
                この条件に合う人はいません
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className="sticky left-0 z-10 bg-background p-2 text-left text-xs font-semibold text-muted-foreground">
              配置／必要
            </th>
            {dates.map((date) => {
              const t = dayTotal(board, date);
              if (!t || t.required === 0)
                return (
                  <td key={date} className="border-t p-2 text-center text-muted-foreground">
                    —
                  </td>
                );
              return (
                <td key={date} className={cn("border-t p-2 text-center font-semibold tabular-nums", t.shortage > 0 ? "text-status-alert" : "text-status-done")} data-testid="week-total">
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
  );
}
