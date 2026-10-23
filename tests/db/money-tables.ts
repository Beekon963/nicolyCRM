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
  // 友達紹介のボーナス（どの調整額がどの紹介の分か。Phase 12）
  "referral_bonuses",
  // 会社の経費（オーナーが立て替えた経費。Phase 16）
  "company_expenses",
  // 案件の単価（Phase 21）
  "event_group_private",
  "audit_logs",
] as const;
