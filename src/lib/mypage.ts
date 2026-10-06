import "server-only";
import { cache } from "react";
import { createAnonClient } from "@/lib/supabase/server";

/** マイページの DB 関数が返す想定内のエラー → 画面の言葉 */
export const MYPAGE_ERRORS: Record<string, string> = {
  invalid_token: "このURLは使えません。URLが再発行された可能性があります。管理者に新しいURLを確認してください。",
  rate_limited: "アクセスが集中しています。少し待ってからもう一度開いてください。",
  not_found: "対象の現場が見つかりません。画面を読み込み直してください。",
  closed: "この現場は中止になったか、すでに終わっています。",
  already_confirmed: "管理者が確定したので、もう修正できません。修正が必要なときは管理者に連絡してください。",
  out_of_window: "報告できる期間を過ぎています。管理者に連絡してください。",
  out_of_range: "この月は入力できません。",
};

export type MypageEvent = {
  id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  meeting_time: string | null;
  meeting_place: string;
  belongings: string;
  notes: string;
  cancelled: boolean;
  venue: { name: string; address: string; nearest_station: string; access_notes: string; green_room: string; parking: string };
};

type Rpc =
  | "mypage_me"
  | "mypage_offers"
  | "mypage_schedule"
  | "mypage_reports"
  | "mypage_report_get"
  | "mypage_report_save"
  | "mypage_availability_get"
  | "mypage_availability_save"
  | "mypage_history"
  | "mypage_respond";

/** マイページの DB 関数を呼ぶ（ログインなし。鍵の検証は DB 側） */
export async function callMypage<T>(fn: Rpc, args: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const supabase = createAnonClient();
  const { data, error } = await supabase.rpc(fn as "mypage_me", args as { p_token: string });
  if (error) {
    // 締め済みの月など DB 側の日本語メッセージ
    if (error.code === "P0001") return { ok: false, error: error.message };
    return { ok: false, error: "通信に失敗しました。電波の良いところでもう一度お試しください。" };
  }
  const d = data as Record<string, unknown> | null;
  if (d && typeof d === "object" && "error" in d) return { ok: false, error: MYPAGE_ERRORS[String(d.error)] ?? "うまくいきませんでした。" };
  return { ok: true, data: data as T };
}

export const getMe = cache((token: string) => callMypage<{ name: string; offers: number; reports: number }>("mypage_me", { p_token: token }));
