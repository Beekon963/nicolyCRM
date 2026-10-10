/**
 * DB の値 → 画面の言葉（要件 §2 の用語集）。画面に英語の値を出さないため、表示は必ずここを通す。
 */
import type { Tone } from "@/components/ui/badge";
import type { Database } from "@/lib/supabase/database.types";

type Enums = Database["public"]["Enums"];

export const ASSIGNMENT_STATUS: Record<Enums["assignment_status"], { label: string; tone: Tone }> = {
  offered: { label: "打診中", tone: "waiting" },
  confirmed: { label: "確定", tone: "done" },
  waitlisted: { label: "補欠", tone: "waiting" },
  declined: { label: "辞退", tone: "muted" },
  cancelled: { label: "キャンセル", tone: "muted" },
  no_show: { label: "当日不稼働", tone: "alert" },
};

export const EVENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  planned: { label: "予定", tone: "waiting" },
  staffed: { label: "人員確定", tone: "done" },
  done: { label: "実施済", tone: "brand" },
  results_confirmed: { label: "実績確定", tone: "done" },
  closed: { label: "締め済", tone: "muted" },
  cancelled: { label: "中止", tone: "muted" },
};

export const AVAILABILITY: Record<Enums["availability_status"] | "none", { mark: string; label: string; tone: Tone }> = {
  ok: { mark: "○", label: "稼働できる", tone: "done" },
  maybe: { mark: "△", label: "調整すれば可", tone: "waiting" },
  ng: { mark: "×", label: "稼働できない", tone: "alert" },
  none: { mark: "−", label: "未提出", tone: "muted" },
};

export const STAFF_STATUS: Record<Enums["staff_status"], { label: string; tone: Tone }> = {
  active: { label: "稼働中", tone: "done" },
  paused: { label: "休止", tone: "waiting" },
  ended: { label: "終了", tone: "muted" },
};

export const NOTE_KIND: Record<Enums["note_kind"], { label: string; tone: Tone }> = {
  last_minute_cancel: { label: "直前キャンセル", tone: "alert" },
  late: { label: "遅延", tone: "alert" },
  trouble: { label: "トラブル", tone: "alert" },
  good: { label: "良かった点", tone: "done" },
  other: { label: "その他", tone: "muted" },
};

/** キャンセル・当日不稼働の理由（DB のトリガー assignments_auto_note と同じコード） */
export const CANCEL_REASONS = [
  { code: "self", label: "本人都合（体調不良・私用など）" },
  { code: "no_contact", label: "連絡なしで来なかった" },
  { code: "late", label: "遅刻・遅延" },
  { code: "trouble", label: "トラブル" },
  { code: "client", label: "取引先・現場の都合" },
  { code: "adjust", label: "人数調整（こちらの都合）" },
  { code: "other", label: "その他" },
] as const;

export const DIFF_REASON: Record<Enums["diff_reason"], string> = {
  cancelled: "キャンセル",
  rejected: "否認",
  input_error: "入力ミス",
  other: "その他",
};

export const COMPANY_KIND: Record<Enums["company_kind"], string> = {
  client: "取引先",
  partner: "協力会社",
};

export const COMPANY_STATUS: Record<Enums["company_status"], { label: string; tone: Tone }> = {
  not_contacted: { label: "未接触", tone: "muted" },
  contacted: { label: "接触済み", tone: "waiting" },
  meeting_set: { label: "商談設定", tone: "waiting" },
  met: { label: "商談済み", tone: "brand" },
  active: { label: "取引中", tone: "done" },
  dormant: { label: "見送り・休眠", tone: "muted" },
};

export const PRIORITY: Record<Enums["priority"], string> = { high: "高", mid: "中", low: "低" };

export const ACTIVITY_KIND: Record<Enums["activity_kind"], string> = {
  call: "架電",
  line: "LINE",
  email: "メール",
  visit: "訪問",
  meeting: "商談",
  other: "その他",
};

export const ACTIVITY_RESULT: Record<Enums["activity_result"], { label: string; tone: Tone }> = {
  reached: { label: "つながった", tone: "brand" },
  absent: { label: "不在", tone: "muted" },
  callback: { label: "折り返し待ち", tone: "waiting" },
  sent_material: { label: "資料送付", tone: "brand" },
  appointment: { label: "アポ獲得", tone: "done" },
  declined: { label: "見送り", tone: "muted" },
};

export const EXPENSE_KIND: Record<Enums["expense_kind"], string> = { transport: "交通費", other: "その他の経費" };

export const EXPENSE_STATUS: Record<Enums["expense_status"], { label: string; tone: Tone }> = {
  pending: { label: "未承認", tone: "waiting" },
  approved: { label: "承認済み", tone: "done" },
  rejected: { label: "却下", tone: "muted" },
};

export const INPUT_SOURCE: Record<Enums["input_source"], string> = { self: "本人", admin: "管理者" };

export const USER_ROLE: Record<Enums["user_role"], string> = { owner: "オーナー", manager: "管理者" };

export const WITHHOLDING_METHOD: Record<Enums["withholding_method"], string> = {
  none: "なし",
  fee: "報酬・料金",
  sales_agent: "外交員報酬",
};

export const ACCOUNT_TYPE: Record<Enums["account_type"], string> = { ordinary: "普通", checking: "当座" };

export const TEMPLATE_KIND: Record<Enums["template_kind"], { label: string; description: string }> = {
  offer: { label: "打診", description: "候補を選んで「打診する」を押したときの文面" },
  confirm: { label: "確定連絡", description: "確定した人に送る文面（集合時刻・持ち物など）" },
  reminder: { label: "前日リマインド", description: "前日に送る文面" },
  availability_request: { label: "稼働可能日の提出依頼（全体向け）", description: "スタッフの LINE グループに送る文面" },
  availability_reminder: { label: "稼働可能日のリマインド（個別）", description: "未提出の人に個別に送る文面" },
  report_request: { label: "実績報告のお願い", description: "未報告の人に送る文面" },
};
