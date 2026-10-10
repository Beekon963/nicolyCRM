"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { AVAILABILITY_MARK, type Board, type BoardDay, type BoardEventChip, type BoardStaffCell } from "@/lib/board";
import { cn } from "@/lib/utils";

/** 日付の列の幅（会場名が長くても広がらないように固定） */
const DAY_W = "w-[5.5rem] min-w-[5.5rem] max-w-[5.5rem]";

/**
 * 稼働表の表（今の月のスプレッドシートと同じ並び）。管理画面と「見るだけリンク」で共通。
 * - 名前の列と日付の行は固定し、表の中だけ縦横に動かす（画面全体は横にずれない）
 * - 押せるのは管理画面だけ（onStaffCell / onClientCell を渡したとき）
 */
export function BoardGrid({
  board,
  onStaffCell,
  onClientCell,
  staffHref,
  className,
}: {
  board: Board;
  onStaffCell?: (staffId: string, date: string) => void;
  onClientCell?: (clientId: string, date: string) => void;
  staffHref?: (id: string) => string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // 今日の列が見えるところまで横に動かす
  useEffect(() => {
    const box = ref.current;
    const today = box?.querySelector<HTMLElement>("[data-today]");
    const first = box?.querySelector<HTMLElement>("[data-name-col]");
    if (box && today && first) box.scrollLeft = Math.max(0, today.offsetLeft - first.offsetWidth - 8);
  }, [board.month]);

  return (
    <div
      ref={ref}
      className={cn("relative max-h-[calc(100dvh-13rem)] overflow-auto border-y md:max-h-[calc(100dvh-10rem)]", className)}
      role="region"
      aria-label={`${board.month.replace("-", "年")}月の稼働表`}
      tabIndex={0}
    >
      <table className="border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th data-name-col className="sticky top-0 left-0 z-30 w-28 min-w-28 border-r border-b bg-background px-2 py-1 text-left md:w-44 md:min-w-44">
              日付
            </th>
            {board.days.map((d) => (
              <th
                key={d.date}
                data-today={d.isToday || undefined}
                title={d.holiday ?? undefined}
                className={cn("sticky top-0 z-20 border-r border-b bg-background px-1 py-1 text-center font-medium", DAY_W, d.isToday && "bg-primary/10", dayColor(d))}
              >
                <span className="block">{d.day}</span>
                <span className="block text-xs">{d.weekday}</span>
              </th>
            ))}
            <th className="sticky top-0 z-20 w-16 min-w-16 border-b bg-background px-1 py-1 text-center font-medium">稼働日数</th>
          </tr>
        </thead>
        <tbody>
          {board.clients.length > 0 && (
            <>
              <SectionRow label="現場（取引先ごと）" days={board.days} />
              <tr>
                <th className="sticky left-0 z-10 border-r border-b bg-background px-2 py-1 text-left font-normal text-muted-foreground">欠員</th>
                {board.days.map((d) => (
                  <td key={d.date} className={cn("border-r border-b px-1 py-1 text-center", DAY_W, d.isToday && "bg-primary/5")}>
                    {d.shortage > 0 ? <span className="font-bold text-status-alert">{d.shortage}人</span> : d.required > 0 ? <span className="text-status-done">0</span> : ""}
                  </td>
                ))}
                <td className="border-b px-1 text-center font-bold">{board.totals.shortage > 0 && <span className="text-status-alert">{board.totals.shortage}</span>}</td>
              </tr>
              {board.clients.map((c) => (
                <tr key={c.id}>
                  <th className="sticky left-0 z-10 border-r border-b bg-background px-2 py-1 text-left font-medium">
                    <span className="line-clamp-2 break-all">{c.name}</span>
                  </th>
                  {board.days.map((d) => {
                    const chips = c.cells[d.date] ?? [];
                    return (
                      <td key={d.date} className={cn("border-r border-b p-0 align-top", DAY_W, d.isToday && "bg-primary/5")}>
                        <Cell onClick={onClientCell && (() => onClientCell(c.id, d.date))} label={`${c.name} ${d.day}日`}>
                          {chips.map((e) => (
                            <EventChip key={e.id} e={e} />
                          ))}
                        </Cell>
                      </td>
                    );
                  })}
                  <td className="border-b" />
                </tr>
              ))}
            </>
          )}
          <SectionRow label={`スタッフ（${board.staff.length}人）`} days={board.days} />
          {board.staff.map((s) => (
            <tr key={s.id}>
              <th className="sticky left-0 z-10 border-r border-b bg-background px-2 py-1 text-left font-medium">
                <span className="flex items-center gap-1">
                  {s.rankName && <span className="shrink-0 rounded border border-primary/30 px-1 text-xs text-primary">{s.rankName}</span>}
                  {staffHref ? (
                    <Link href={staffHref(s.id)} className="truncate hover:underline">
                      {s.name}
                    </Link>
                  ) : (
                    <span className="truncate">{s.name}</span>
                  )}
                </span>
                {s.station && <span className="block truncate text-xs font-normal text-muted-foreground">{s.station}</span>}
              </th>
              {board.days.map((d) => (
                <td key={d.date} className={cn("border-r border-b p-0 align-top", DAY_W, d.isToday && "bg-primary/5")}>
                  <Cell onClick={onStaffCell && (() => onStaffCell(s.id, d.date))} label={`${s.name} ${d.day}日`}>
                    <StaffCellView cell={s.cells[d.date]} />
                  </Cell>
                </td>
              ))}
              <td className="border-b px-1 text-center font-bold">{s.workedDays || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function dayColor(d: BoardDay) {
  if (d.weekday === "日" || d.holiday) return "text-status-alert";
  if (d.weekday === "土") return "text-primary";
  return undefined;
}

function SectionRow({ label, days }: { label: string; days: BoardDay[] }) {
  return (
    <tr>
      <th className="sticky left-0 z-10 border-r border-b bg-muted px-2 py-1 text-left font-bold">{label}</th>
      <td colSpan={days.length + 1} className="border-b bg-muted" />
    </tr>
  );
}

function Cell({ onClick, label, children }: { onClick?: () => void; label: string; children: React.ReactNode }) {
  const cls = "flex min-h-11 w-full min-w-0 flex-col items-stretch gap-0.5 overflow-hidden p-0.5 text-left";
  if (!onClick) return <div className={cls}>{children}</div>;
  return (
    <button type="button" onClick={onClick} aria-label={label} className={cn(cls, "hover:bg-accent focus-visible:bg-accent")}>
      {children}
    </button>
  );
}

function EventChip({ e }: { e: BoardEventChip }) {
  return (
    <span
      className={cn(
        "flex min-w-0 flex-col rounded px-1 leading-tight",
        e.cancelled ? "bg-muted text-muted-foreground line-through" : e.shortage > 0 ? "bg-status-alert-bg text-status-alert" : "bg-status-done-bg text-status-done",
      )}
      title={e.venueName}
    >
      <span className="truncate">{e.venueName}</span>
      <span className="font-bold">
        {e.cancelled ? "中止" : `${e.confirmed}/${e.required}`}
        {e.offered > 0 && !e.cancelled && <span className="ml-1 font-normal text-status-waiting">打{e.offered}</span>}
      </span>
    </span>
  );
}

function StaffCellView({ cell }: { cell: BoardStaffCell | undefined }) {
  if (!cell) return null;
  if (cell.assignments.length) {
    return cell.assignments.map((a) => (
      <span
        key={a.id}
        title={`${a.venueName}（${a.clientName}）`}
        className={cn(
          "truncate rounded px-1 leading-snug",
          a.status === "confirmed" && "bg-status-done-bg text-status-done",
          a.status === "offered" && "bg-status-waiting-bg text-status-waiting",
          a.status === "waitlisted" && "bg-muted text-muted-foreground",
        )}
      >
        {a.status === "offered" && "打 "}
        {a.status === "waitlisted" && "補 "}
        {a.venueName}
      </span>
    ));
  }
  if (!cell.availability) return null;
  return (
    <span
      className={cn(
        "text-center text-base font-bold",
        cell.availability === "ok" && "text-status-done",
        cell.availability === "maybe" && "text-status-waiting",
        cell.availability === "ng" && "text-muted-foreground",
      )}
    >
      {AVAILABILITY_MARK[cell.availability]}
    </span>
  );
}

/** 表の下の凡例 */
export function BoardLegend({ admin }: { admin?: boolean }) {
  return (
    <p className="px-4 py-2 text-sm text-muted-foreground">
      <span className="text-status-done">緑</span> = 確定、<span className="text-status-waiting">黄（打）</span> = 打診中、灰（補）= 補欠、○△× = 稼働可能日。上の段の
      <span className="text-status-alert">赤</span> は欠員あり（確定/必要人数）。
      {admin && " マスを押すと打診・確定や稼働可能日の入力ができます。"}
    </p>
  );
}
