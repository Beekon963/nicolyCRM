/** 変更履歴の表示用（テーブル名・列名 → 画面の言葉） */
import { ASSIGNMENT_STATUS, COMPANY_STATUS, DIFF_REASON, EXPENSE_STATUS, USER_ROLE, WITHHOLDING_METHOD } from "@/lib/labels";

export const TABLE_LABEL: Record<string, string> = {
  app_users: "ユーザー",
  companies: "会社（営業）",
  assignments: "アサイン",
  reports: "実績報告",
  report_items: "獲得件数",
  expenses: "交通費・経費",
  staff_private: "スタッフのお金・口座",
  rank_rates: "ランクの基準日当",
  company_billing: "取引先の請求設定",
  client_rates: "標準単価",
  event_rates: "現場の単価上書き",
  incentive_rates: "インセンティブ単価",
  event_incentive_rates: "現場のインセンティブ上書き",
  assignment_private: "日当の上書き",
  payment_adjustments: "調整額",
  monthly_closings: "月次締め",
  payments: "支払い",
  invoices: "請求",
  owner_settings: "税・源泉の設定",
  monthly_targets: "月次目標",
};

export const FIELD_LABEL: Record<string, string> = {
  status: "状態",
  name: "名前",
  role: "権限",
  is_active: "有効",
  next_action_date: "次回アクション日",
  next_action: "次にやること",
  priority: "優先度",
  owner_user_id: "担当者",
  memo: "メモ",
  reported_count: "速報件数",
  confirmed_count: "確定件数",
  diff_reason: "差分の理由",
  diff_note: "差分のメモ",
  confirmed_at: "確定日時",
  confirmed_by: "確定した人",
  submitted_at: "送信日時",
  comment: "コメント",
  amount: "金額",
  reviewed_by: "承認した人",
  reviewed_at: "承認日時",
  reject_reason: "却下の理由",
  base_daily_rate: "基本日当",
  daily_rate_override: "日当の上書き",
  withholding_method: "源泉の方式",
  invoice_number: "インボイス登録番号",
  contract_date: "契約締結日",
  contract_file_path: "契約書",
  bank_name: "銀行",
  bank_branch: "支店",
  account_type: "口座種別",
  account_number: "口座番号",
  account_holder_kana: "口座名義",
  responded_at: "回答日時",
  response_source: "回答の入力元",
  confirm_notice_sent_at: "確定連絡",
  reminder_sent_at: "前日リマインド",
  cancel_reason_code: "キャンセル理由",
  cancel_reason: "キャンセルのメモ",
  closing_day: "締め日",
  bill_transport: "交通費を請求に含める",
  invoice_note: "請求書送付先メモ",
  reason: "理由",
  value: "値",
};

const VALUE_LABEL: Record<string, Record<string, string>> = {
  status: {
    ...Object.fromEntries(Object.entries(ASSIGNMENT_STATUS).map(([k, v]) => [k, v.label])),
    ...Object.fromEntries(Object.entries(COMPANY_STATUS).map(([k, v]) => [k, v.label])),
    ...Object.fromEntries(Object.entries(EXPENSE_STATUS).map(([k, v]) => [k, v.label])),
  },
  role: USER_ROLE,
  diff_reason: DIFF_REASON,
  withholding_method: WITHHOLDING_METHOD,
};

export function formatValue(field: string, v: unknown): string {
  if (v == null || v === "") return "（空）";
  if (typeof v === "boolean") return v ? "はい" : "いいえ";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  return VALUE_LABEL[field]?.[String(v)] ?? (typeof v === "object" ? JSON.stringify(v) : String(v));
}
