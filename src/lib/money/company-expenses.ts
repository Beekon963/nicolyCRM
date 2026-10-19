/**
 * 会社の経費の合計（Phase 16）。今のスプレッドシートの「合計金額・記録件数」と同じものを、
 * 払った人ごと・区分ごとにも出す。取り消した経費は入れない。金額は整数（円・税込）。
 */
export type CompanyExpenseLike = { amount: number; paidBy: string | null; category: string; voided?: boolean };

/** まとめた1つ分（key は払った人の id か区分。払った人の null は「まだ決めていない」、区分の "" は「区分なし」） */
export type ExpenseGroup<K> = { key: K; total: number; count: number };

export type CompanyExpenseSummary = {
  total: number;
  count: number;
  /** 払った人ごと。金額の多い順 */
  byPayer: ExpenseGroup<string | null>[];
  /** 区分ごと。金額の多い順 */
  byCategory: ExpenseGroup<string>[];
};

export function summarizeCompanyExpenses(rows: CompanyExpenseLike[]): CompanyExpenseSummary {
  const live = rows.filter((r) => !r.voided);
  const group = <K>(keyOf: (r: CompanyExpenseLike) => K): ExpenseGroup<K>[] => {
    const m = new Map<K, ExpenseGroup<K>>();
    for (const r of live) {
      const k = keyOf(r);
      const g = m.get(k) ?? { key: k, total: 0, count: 0 };
      g.total += r.amount;
      g.count += 1;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.total - a.total || b.count - a.count);
  };
  return {
    total: live.reduce((n, r) => n + r.amount, 0),
    count: live.length,
    byPayer: group((r) => r.paidBy),
    byCategory: group((r) => r.category.trim()),
  };
}
