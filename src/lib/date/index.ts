/**
 * 日付処理はすべてこのモジュールを通す（CLAUDE.md「日付」参照）。
 *
 * - アプリ内の「日付」は日本時間の暦日を `YYYY-MM-DD` 文字列（DateString）で表す。
 *   DB の `date` 型ともそのまま対応する。
 * - サーバー（Vercel / Supabase）は UTC で動くため、`new Date().getDate()` などの
 *   ローカル時刻メソッドは使わない。必ず `todayJst()` などを使う。
 * - 祝日データ（@holiday-jp/holiday_jp）は大きいので、クライアント側では import せず
 *   サーバー側で必要な期間だけ計算して渡す。
 */
import holidayJp from "@holiday-jp/holiday_jp";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const TIME_ZONE = "Asia/Tokyo";

/** 日本時間の暦日 `YYYY-MM-DD` */
export type DateString = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"] as const;
export type WeekdayJa = (typeof WEEKDAYS_JA)[number];

const holidays = holidayJp.holidays as Record<string, { name: string }>;

function parse(date: DateString): { y: number; m: number; d: number } {
  const match = DATE_RE.exec(date);
  if (!match) throw new Error(`日付の形式が不正です: ${date}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  // 2026-02-30 のような存在しない日付を弾く
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d) {
    throw new Error(`存在しない日付です: ${date}`);
  }
  return { y, m, d };
}

function fromUtcDate(utc: Date): DateString {
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utc.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isDateString(value: string): boolean {
  try {
    parse(value);
    return true;
  } catch {
    return false;
  }
}

/** ある瞬間（UTC の Date）が日本時間で何日か */
export function toJstDateString(instant: Date): DateString {
  return formatInTimeZone(instant, TIME_ZONE, "yyyy-MM-dd");
}

/** 日本時間の今日 */
export function todayJst(now: Date = new Date()): DateString {
  return toJstDateString(now);
}

/** 日本時間の明日 */
export function tomorrowJst(now: Date = new Date()): DateString {
  return addDays(todayJst(now), 1);
}

/** 暦日の加減算（タイムゾーンの影響を受けない） */
export function addDays(date: DateString, days: number): DateString {
  const { y, m, d } = parse(date);
  return fromUtcDate(new Date(Date.UTC(y, m - 1, d + days)));
}

/** b − a の日数 */
export function diffDays(a: DateString, b: DateString): number {
  const pa = parse(a);
  const pb = parse(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

export function weekdayJa(date: DateString): WeekdayJa {
  const { y, m, d } = parse(date);
  return WEEKDAYS_JA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** 土日 */
export function isWeekend(date: DateString): boolean {
  const w = weekdayJa(date);
  return w === "土" || w === "日";
}

/** 日本の祝日名（祝日でなければ null） */
export function holidayName(date: DateString): string | null {
  parse(date);
  return holidays[date]?.name ?? null;
}

export function isHoliday(date: DateString): boolean {
  return holidayName(date) !== null;
}

/** 画面表示用: `10/6(火)` */
export function formatShortJa(date: DateString): string {
  const { m, d } = parse(date);
  return `${m}/${d}(${weekdayJa(date)})`;
}

/** 画面表示用: `2026年10月6日(火)` */
export function formatLongJa(date: DateString): string {
  const { y, m, d } = parse(date);
  return `${y}年${m}月${d}日(${weekdayJa(date)})`;
}

/** 対象月 `YYYY-MM` */
export function monthOf(date: DateString): string {
  return date.slice(0, 7);
}

/** 月の初日と末日 */
export function monthRange(month: string): { start: DateString; end: DateString } {
  const start = `${month}-01`;
  const { y, m } = parse(start);
  return { start, end: fromUtcDate(new Date(Date.UTC(y, m, 0))) };
}

/** 翌月 `YYYY-MM` */
export function nextMonth(month: string): string {
  const { y, m } = parse(`${month}-01`);
  return fromUtcDate(new Date(Date.UTC(y, m, 1))).slice(0, 7);
}

/** 期間内の日付を列挙（start〜end を含む） */
export function eachDay(start: DateString, end: DateString): DateString[] {
  const n = diffDays(start, end);
  if (n < 0) return [];
  return Array.from({ length: n + 1 }, (_, i) => addDays(start, i));
}

/** 日本時間の「日付＋時刻」を瞬間（Date）に変換する。DB の timestamptz に入れるとき用 */
export function jstToInstant(date: DateString, time: string): Date {
  parse(date);
  if (!TIME_RE.test(time)) throw new Error(`時刻の形式が不正です: ${time}`);
  return fromZonedTime(`${date}T${time}:00`, TIME_ZONE);
}

/** 瞬間を日本時間の `HH:mm` で表示 */
export function formatTimeJst(instant: Date): string {
  return formatInTimeZone(instant, TIME_ZONE, "HH:mm");
}
