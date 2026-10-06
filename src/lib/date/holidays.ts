/**
 * 日本の祝日（要件 §6）。データが大きいのでサーバー側だけで使い、画面には必要な期間の分だけ渡す。
 * holiday_jp.isHoliday(new Date()) はサーバーの時刻（UTC）で日付を判定してずれるので使わない。
 */
import "server-only";
import holidayJp from "@holiday-jp/holiday_jp";
import { eachDay, parse, type DateString } from "./index";

const holidays = holidayJp.holidays as Record<string, { name: string }>;

/** 祝日名（祝日でなければ null） */
export function holidayName(date: DateString): string | null {
  parse(date);
  return holidays[date]?.name ?? null;
}

export function isHoliday(date: DateString): boolean {
  return holidayName(date) !== null;
}

/** 期間内の祝日 { 日付: 祝日名 } */
export function holidaysBetween(start: DateString, end: DateString): Record<DateString, string> {
  const out: Record<DateString, string> = {};
  for (const d of eachDay(start, end)) {
    const name = holidays[d]?.name;
    if (name) out[d] = name;
  }
  return out;
}
