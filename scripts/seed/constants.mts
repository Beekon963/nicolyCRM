/**
 * ダミーデータの決まった値。seed の生成とテストの両方で使う。
 */

// 管理者に見えてはいけない金額・口座の目印（e2e/money-leak.spec.ts と tests/db で使う）
export const SENTINELS = {
  baseDailyRate: 1357913,
  dailyRateOverride: 2468024,
  accountNumber: "9753197",
  clientRate: 8642086,
  incentiveRate: 3141592,
  rankRate: 1928374,
  adjustment: 5550123,
} as const;

export const SEED_USERS = {
  owner: { id: "00000000-0000-4000-8000-000000000001", email: "owner@example.com", name: "テスト オーナー" },
  manager: { id: "00000000-0000-4000-8000-000000000002", email: "manager@example.com", name: "テスト 管理者" },
  inactive: { id: "00000000-0000-4000-8000-000000000003", email: "inactive@example.com", name: "無効 管理者" },
} as const;

export const SEED_PASSWORD = "password123";
