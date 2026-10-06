/** まとめて作成の日付（期間 × 曜日）。要件 §4.2 */
import { addDays, eachDay, monthRange, nextMonth, weekdayJa, type DateString } from "@/lib/date";

export const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export function datesFor(from: DateString, to: DateString, weekdays: Weekday[]): DateString[] {
  if (!from || !to || from > to) return [];
  return eachDay(from, to).filter((d) => weekdays.includes(weekdayJa(d) as Weekday));
}

/** よく使う期間（ワンタップ候補） */
export function presetRanges(today: DateString): { label: string; from: DateString; to: DateString; weekdays: Weekday[] }[] {
  const wd = "月火水木金土日".indexOf(weekdayJa(today)); // 月=0 … 日=6
  const nextMon = addDays(today, 7 - wd);
  const thisMonth = today.slice(0, 7);
  const nm = monthRange(nextMonth(thisMonth));
  return [
    { label: "来週の土日", from: addDays(nextMon, 5), to: addDays(nextMon, 6), weekdays: ["土", "日"] },
    { label: "今月の残りの土日", from: addDays(today, 1), to: monthRange(thisMonth).end, weekdays: ["土", "日"] },
    { label: "来月の土日", from: nm.start, to: nm.end, weekdays: ["土", "日"] },
  ];
}
