/**
 * 支払い（スタッフへ。要件 §4.9）
 * - 日当: アサインごとの上書き → スタッフの基本日当。当日不稼働・キャンセル・中止の現場は 0
 * - インセンティブ: 獲得項目ごとの単価（現場ごとの上書き → 全体の標準）× 件数
 * - 調整額（＋/−）、承認済みの交通費・経費
 * - 源泉徴収: 対象額 ＝ 日当 ＋ インセンティブ ＋ 調整額（＋ 設定で交通費・経費）。税抜で計算する設定なら税抜換算
 * - 差引支払額 ＝ 日当計 ＋ インセンティブ計 ＋ 調整額 ＋ 交通費・経費 − 源泉徴収額
 * 日当・インセンティブは税込として扱う（要件 §13-6）。
 */
import { type CountBasis, type ItemCount, itemAmount, itemQty } from "./invoice";
import { applyRate, sum } from "./round";
import { withholdingAmount, type WithholdingMethod } from "./withholding";

export type PayAssignment = {
  /** 実際に稼働した（確定のアサインで、現場が中止でない） */
  worked: boolean;
  /** 日当（アサインの上書き ?? スタッフの基本日当）。決まっていなければ null */
  dailyRate: number | null;
  items: ItemCount[];
  /** 獲得項目ごとのインセンティブ単価（現場の上書き ?? 全体の標準） */
  incentiveRate: (itemId: string) => number | null;
};

export type AssignmentPay = {
  daily: number;
  incentive: number;
  lines: { itemId: string; unit: number; qty: number; amount: number }[];
  missingDailyRate: boolean;
};

export function payAssignment(a: PayAssignment, basis: CountBasis): AssignmentPay {
  if (!a.worked) return { daily: 0, incentive: 0, lines: [], missingDailyRate: false };
  const lines = a.items
    .map((it) => {
      const qty = itemQty(it, basis);
      const unit = a.incentiveRate(it.itemId) ?? 0;
      return { itemId: it.itemId, unit, qty, amount: itemAmount(unit, qty) };
    })
    .filter((l) => l.qty > 0);
  return { daily: a.dailyRate ?? 0, incentive: sum(lines.map((l) => l.amount)), lines, missingDailyRate: a.dailyRate == null };
}

export type WithholdingSettings = {
  /** 源泉の対象額に交通費・経費を含める（初期値 true。要件 §13-7） */
  includeExpenses: boolean;
  /** 税込で計算する（初期値 true）。false なら税抜換算した額を対象にする */
  taxInclusive: boolean;
  /** 税抜換算に使う消費税率（%） */
  taxRatePercent: number;
};

export type StaffMonthPay = {
  daily: number;
  incentive: number;
  adjustment: number;
  expense: number;
  /** 報酬（日当 ＋ インセンティブ ＋ 調整額） */
  reward: number;
  withholdingBase: number;
  withholding: number;
  net: number;
};

/** 税込の額を税抜に換算する（1円未満切り捨て） */
export function excludeTax(amount: number, taxRatePercent: number): number {
  if (amount <= 0) return amount;
  return applyRate(amount, 100, 100 + taxRatePercent, "floor");
}

export function payStaffMonth(
  input: { method: WithholdingMethod; assignments: AssignmentPay[]; expenses: number[]; adjustments: number[] },
  s: WithholdingSettings,
): StaffMonthPay {
  const daily = sum(input.assignments.map((a) => a.daily));
  const incentive = sum(input.assignments.map((a) => a.incentive));
  const adjustment = sum(input.adjustments);
  const expense = sum(input.expenses);
  const reward = daily + incentive + adjustment;
  let base = reward + (s.includeExpenses ? expense : 0);
  if (!s.taxInclusive) base = excludeTax(base, s.taxRatePercent);
  base = Math.max(0, base);
  const withholding = withholdingAmount(input.method, base);
  return { daily, incentive, adjustment, expense, reward, withholdingBase: base, withholding, net: reward + expense - withholding };
}
