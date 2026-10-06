"use client";

import { addDays, monthRange, parse, weekdayJa, type DateString } from "@/lib/date";
import { AVAILABILITY } from "@/lib/labels";
import { cn } from "@/lib/utils";

export type AvailabilityStatus = "ok" | "maybe" | "ng";
const NEXT: Record<AvailabilityStatus | "none", AvailabilityStatus | null> = { none: "ok", ok: "maybe", maybe: "ng", ng: null };

/** タップで ○ → △ → × → 未入力 と切り替わる（要件 §4.5） */
export function nextStatus(s: AvailabilityStatus | null | undefined): AvailabilityStatus | null {
  return NEXT[s ?? "none"];
}

const TONE: Record<AvailabilityStatus, string> = {
  ok: "bg-status-done-bg text-status-done border-status-done/40",
  maybe: "bg-status-waiting-bg text-status-waiting border-status-waiting/40",
  ng: "bg-muted text-muted-foreground border-border",
};

/**
 * 稼働可能日の月カレンダー。
 * editable のとき、日付をタップすると onToggle が呼ばれる（minDate より前は押せない）。
 */
export function AvailabilityCalendar({
  month,
  values,
  holidays = {},
  editable = false,
  minDate,
  marks = {},
  onToggle,
}: {
  /** 'YYYY-MM' */
  month: string;
  values: Record<DateString, AvailabilityStatus>;
  holidays?: Record<DateString, string>;
  editable?: boolean;
  minDate?: DateString;
  /** 日付の下に出す印（確定した現場など） */
  marks?: Record<DateString, string>;
  onToggle?: (date: DateString, next: AvailabilityStatus | null) => void;
}) {
  const { start, end } = monthRange(month);
  const lead = "日月火水木金土".indexOf(weekdayJa(start));
  const days: (DateString | null)[] = Array.from({ length: lead }, () => null);
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  const { m } = parse(start);

  return (
    <div className="w-full max-w-md">
      <p className="mb-1 font-bold">{m}月</p>
      <div className="grid grid-cols-7 gap-1 text-center">
        {["日", "月", "火", "水", "木", "金", "土"].map((w, i) => (
          <div key={w} className={cn("text-sm", i === 0 && "text-status-alert", i === 6 && "text-primary")}>
            {w}
          </div>
        ))}
        {days.map((d, i) => {
          if (!d) return <div key={`blank-${i}`} />;
          const v = values[d];
          const wd = i % 7;
          const holiday = holidays[d];
          const disabled = !editable || (minDate !== undefined && d < minDate);
          const dayNum = Number(d.slice(8));
          const content = (
            <>
              <span className={cn("text-xs", (wd === 0 || holiday) && "text-status-alert", wd === 6 && !holiday && "text-primary")}>
                {dayNum}
              </span>
              <span className="text-lg leading-none font-bold">{v ? AVAILABILITY[v].mark : ""}</span>
              {marks[d] && <span className="w-full truncate text-[10px] leading-tight text-primary">{marks[d]}</span>}
            </>
          );
          const cls = cn(
            "flex aspect-square min-h-11 flex-col items-center justify-start gap-0.5 rounded-md border p-0.5",
            v ? TONE[v] : "border-border",
            !disabled && "active:scale-95",
            editable && disabled && "opacity-40",
          );
          return editable ? (
            <button
              key={d}
              type="button"
              disabled={disabled}
              title={holiday}
              aria-label={`${m}月${dayNum}日 ${v ? AVAILABILITY[v].label : "未入力"}`}
              className={cls}
              onClick={() => onToggle?.(d, nextStatus(v))}
            >
              {content}
            </button>
          ) : (
            <div key={d} title={holiday} className={cls}>
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
