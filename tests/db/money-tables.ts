/**
 * ★ 金額系テーブル。追加・変更したら必ずここに足す（CLAUDE.md「DB・権限」）。
 */

/** オーナーだけが読み書きできるテーブル（管理者からは 0 件） */
export const MONEY_TABLES = [
  "staff_private",
  "rank_rates",
  "company_billing",
  "client_rates",
  "event_rates",
  "incentive_rates",
  "event_incentive_rates",
  "assignment_private",
  "payment_adjustments",
  "monthly_closings",
  "closing_logs",
  "payments",
  "invoices",
  "owner_settings",
  "monthly_targets",
  "audit_logs",
] as const;
