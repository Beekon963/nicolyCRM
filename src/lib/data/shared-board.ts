import "server-only";
import { buildBoard, type Board, type BoardAssignment, type BoardAvailability, type BoardEvent, type BoardStaff } from "@/lib/board";
import { monthRange, todayJst } from "@/lib/date";
import { holidaysBetween } from "@/lib/date/holidays";
import { createAnonClient } from "@/lib/supabase/server";

const ERRORS: Record<string, string> = {
  invalid_token: "このリンクは使えません。新しいリンクを担当者に確認してください。",
  rate_limited: "アクセスが集中しています。少し待ってから開き直してください。",
  out_of_range: "この月の稼働表は見られません（見られるのは先月〜3か月先です）。",
};

type Raw = {
  error?: string;
  events: Omit<BoardEvent, "offered_count">[];
  staff: BoardStaff[];
  assignments: BoardAssignment[];
  availability: BoardAvailability[];
};

/** 見るだけリンクの稼働表（ログインなし。鍵の確認と、出す情報の絞り込みは DB の share_board で行う） */
export async function loadSharedBoard(token: string, month: string): Promise<{ ok: true; board: Board } | { ok: false; error: string; code: string }> {
  const { data, error } = await createAnonClient().rpc("share_board", { p_token: token, p_month: `${month}-01` });
  if (error || !data) return { ok: false, code: "unavailable", error: "いまは開けません。時間をおいて開き直してください。" };
  const r = data as unknown as Raw;
  if (r.error) return { ok: false, code: r.error, error: ERRORS[r.error] ?? ERRORS.invalid_token };
  const { start, end } = monthRange(month);
  return {
    ok: true,
    board: buildBoard({
      month,
      today: todayJst(),
      holidays: holidaysBetween(start, end),
      // 打診中は共有しない（確定した予定だけ）
      events: r.events.map((e) => ({ ...e, offered_count: 0 })),
      staff: r.staff,
      assignments: r.assignments,
      availability: r.availability,
    }),
  };
}
