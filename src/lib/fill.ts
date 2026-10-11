/**
 * 埋まり具合（ゲージ用。Phase 6）。必要人数のうち、欠員を除いた人数と割合（%、切り捨て）。
 * 必要人数が 0 のときは 100%。
 */
export type Fill = { required: number; shortage: number; filled: number; pct: number };

export function fillOf(rows: { required: number; shortage: number }[]): Fill {
  const required = rows.reduce((n, r) => n + Math.max(0, r.required), 0);
  const shortage = Math.min(
    required,
    rows.reduce((n, r) => n + Math.max(0, r.shortage), 0),
  );
  const filled = required - shortage;
  return { required, shortage, filled, pct: required === 0 ? 100 : Math.floor((filled * 100) / required) };
}
