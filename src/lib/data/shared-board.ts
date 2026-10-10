import "server-only";
import type { Board } from "@/lib/board";
import { boardFromSnapshot, type BoardSnapshot } from "@/lib/board/snapshot";
import { monthRange, todayJst } from "@/lib/date";
import { holidaysBetween } from "@/lib/date/holidays";
import { createAnonClient } from "@/lib/supabase/server";

const ERRORS: Record<string, string> = {
  invalid_token: "このリンクは使えません。新しいリンクを担当者に確認してください。",
  rate_limited: "アクセスが集中しています。少し待ってから開き直してください。",
  out_of_range: "この月の稼働表は見られません（見られるのは先月〜3か月先です）。",
};

/** 見るだけリンクの稼働表（ログインなし。鍵の確認と、出す情報の絞り込みは DB の share_board で行う） */
export async function loadSharedBoard(token: string, month: string): Promise<{ ok: true; board: Board } | { ok: false; error: string; code: string }> {
  const { data, error } = await createAnonClient().rpc("share_board", { p_token: token, p_month: `${month}-01` });
  if (error || !data) return { ok: false, code: "unavailable", error: "いまは開けません。時間をおいて開き直してください。" };
  const r = data as unknown as BoardSnapshot & { error?: string };
  if (r.error) return { ok: false, code: r.error, error: ERRORS[r.error] ?? ERRORS.invalid_token };
  const { start, end } = monthRange(month);
  return { ok: true, board: boardFromSnapshot(r, month, todayJst(), holidaysBetween(start, end)) };
}
