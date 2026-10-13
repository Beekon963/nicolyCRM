/**
 * 支払明細書（Phase 13）。いただいた書式（一覧 ＋ 一人ずつの明細書）の形にまとめる。
 * 金額はスタッフごとの支払い（build.ts の StaffMoney）からだけ作り、ここで新しく計算しない
 * （合計・本体価格・消費税の分け方だけを出す）。
 *
 * - 業務委託報酬: 日当（遠方の上乗せを除く）ごとに「単価 × 稼働数」
 * - 遠方の上乗せ・インセンティブ・調整額（友達紹介のボーナスなど）・交通費・経費は行を分ける
 * - 合計（税込）＝ 報酬 ＋ 交通費・経費。本体価格 ＝ 合計 × 100 ÷（100 ＋ 税率）の円未満切捨て、消費税は差額
 * - 源泉徴収の対象額・税額・お支払額は、支払いの計算（お金の設定）のとおり
 */
import { sumCounts } from "@/lib/count";
import type { StaffMoney } from "./build";
import { excludeTax } from "./pay";
import { sum } from "./round";
import type { WithholdingMethod } from "./withholding";

export type StatementLine = { label: string; unit: number; qty: number; amount: number };

export type Statement = {
  staffId: string;
  name: string;
  rankName: string | null;
  lines: StatementLine[];
  /** 稼働数（実際に稼働した数） */
  worked: number;
  /** 一覧に出す単価（いちばん多い日当）。日当が2つ以上あれば others が true */
  mainUnit: { unit: number; others: boolean } | null;
  /** 合計（税込） */
  total: number;
  /** うち本体価格 */
  base: number;
  /** うち消費税 */
  tax: number;
  withholdingBase: number;
  withholding: number;
  /** お支払額 */
  net: number;
  method: WithholdingMethod;
  /** 実績が確定していない稼働を含む（仮） */
  estimate: boolean;
  /** 日当が決まっていない稼働がある */
  missingDailyRate: boolean;
};

export function buildStatement(s: StaffMoney, opts: { rankName?: string | null; itemName: (id: string) => string; taxRatePercent: number }): Statement {
  const rankName = s.rankName ?? opts.rankName ?? null;
  const worked = s.assignments.filter((a) => a.worked);

  // 業務委託報酬: 日当（遠方の上乗せを除く）ごと。多い順
  const byUnit = new Map<number, number>();
  for (const a of worked) {
    const unit = a.pay.daily - (a.pay.travel ?? 0);
    byUnit.set(unit, (byUnit.get(unit) ?? 0) + 1);
  }
  const units = [...byUnit].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const label = rankName ? `業務委託報酬（ランク${rankName}）` : "業務委託報酬";
  const lines: StatementLine[] = units.map(([unit, qty]) => ({ label, unit, qty, amount: unit * qty }));

  // 遠方の上乗せ（1回の額ごと）
  const travel = new Map<number, number>();
  for (const a of worked) if ((a.pay.travel ?? 0) > 0) travel.set(a.pay.travel, (travel.get(a.pay.travel) ?? 0) + 1);
  for (const [unit, qty] of [...travel].sort((a, b) => a[0] - b[0])) lines.push({ label: "遠方の上乗せ", unit, qty, amount: unit * qty });

  // インセンティブ（項目と単価ごと。件数は小数第2位まで足す）
  const inc = new Map<string, { itemId: string; unit: number; qty: (number | null)[]; amount: number }>();
  for (const a of worked) {
    for (const l of a.pay.lines) {
      if (!l.amount) continue;
      const key = `${l.itemId}:${l.unit}`;
      const cur = inc.get(key) ?? { itemId: l.itemId, unit: l.unit, qty: [], amount: 0 };
      cur.qty.push(l.qty);
      cur.amount += l.amount;
      inc.set(key, cur);
    }
  }
  for (const v of inc.values()) lines.push({ label: `インセンティブ（${opts.itemName(v.itemId)}）`, unit: v.unit, qty: sumCounts(v.qty), amount: v.amount });

  // 調整額（友達紹介のボーナスなど）は1件ずつ
  for (const a of s.adjustments) lines.push({ label: a.reason, unit: a.amount, qty: 1, amount: a.amount });

  // 交通費・経費
  if (s.totals.expense) lines.push({ label: "交通費・経費", unit: s.totals.expense, qty: 1, amount: s.totals.expense });

  const total = s.totals.reward + s.totals.expense;
  const base = excludeTax(total, opts.taxRatePercent);
  return {
    staffId: s.id,
    name: s.name,
    rankName,
    lines,
    worked: worked.length,
    mainUnit: units.length ? { unit: units[0][0], others: units.length > 1 } : null,
    total,
    base,
    tax: total - base,
    withholdingBase: s.totals.withholdingBase,
    withholding: s.totals.withholding,
    net: s.totals.net,
    method: s.method,
    estimate: s.assignments.some((a) => a.status === "estimate"),
    missingDailyRate: s.missingDailyRate,
  };
}

/** 一覧の合計の行 */
export function statementTotals(list: Statement[]) {
  return {
    worked: sum(list.map((s) => s.worked)),
    total: sum(list.map((s) => s.total)),
    base: sum(list.map((s) => s.base)),
    withholding: sum(list.map((s) => s.withholding)),
    net: sum(list.map((s) => s.net)),
  };
}

/** 明細書の「源泉徴収の対象額」「源泉徴収税額」の見出し（お金の設定と方式で変わる） */
export function withholdingLabels(method: WithholdingMethod, taxInclusive: boolean): { base: string; amount: string } {
  if (method === "none") return { base: "源泉徴収の対象額（対象外）", amount: "源泉徴収税額（対象外）" };
  const what = taxInclusive ? "税込の額" : "本体価格";
  if (method === "sales_agent") return { base: `源泉徴収の対象額（${what} − 12万円）`, amount: "源泉徴収税額（対象額 × 10.21%）" };
  return { base: `源泉徴収の対象額（${what}）`, amount: "源泉徴収税額（対象額 × 10.21%）" };
}

/** 明細書の下に書く前提条件（お金の設定のとおり） */
export function statementNotes(opts: { method: WithholdingMethod; taxInclusive: boolean; includeExpenses: boolean; taxRatePercent: number }): string[] {
  const notes = [
    "単価は税込です。",
    `本体価格は税込金額 × 100 ÷ ${100 + opts.taxRatePercent} の円未満切捨て、消費税は差額で算出しています。`,
  ];
  if (opts.method === "none") notes.push("源泉徴収の対象外です。");
  else {
    const what = opts.taxInclusive ? "税込の額" : "本体価格";
    notes.push(
      opts.method === "sales_agent"
        ? `源泉徴収は${what}から12万円を引いた額に10.21%を乗じています（円未満切捨て）。`
        : `源泉徴収は${what}に10.21%を乗じています（円未満切捨て・控除なし）。`,
    );
    if (!opts.includeExpenses) notes.push("交通費・経費は源泉徴収の対象に含めていません。");
  }
  return notes;
}
