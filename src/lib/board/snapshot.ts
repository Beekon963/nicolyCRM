/**
 * DB の board_json()（見るだけリンク・書き出しで共通、金額なし）の結果を稼働表にする。
 */
import { monthRange } from "@/lib/date";
import { buildBoard, type Board, type BoardAssignment, type BoardAvailability, type BoardEvent, type BoardStaff } from "./index";

export type BoardSnapshot = {
  events: Omit<BoardEvent, "offered_count">[];
  staff: BoardStaff[];
  assignments: BoardAssignment[];
  availability: BoardAvailability[];
};

export function boardFromSnapshot(s: BoardSnapshot, month: string, today: string, holidays: Record<string, string>): Board {
  const { start, end } = monthRange(month);
  const inMonth = Object.fromEntries(Object.entries(holidays).filter(([d]) => d >= start && d <= end));
  return buildBoard({
    month,
    today,
    holidays: inMonth,
    // 打診中は共有しない（確定した予定だけ）
    events: s.events.map((e) => ({ ...e, offered_count: 0 })),
    staff: s.staff,
    assignments: s.assignments,
    availability: s.availability,
  });
}
