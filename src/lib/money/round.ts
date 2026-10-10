/**
 * お金の計算の土台。金額は整数（円）だけで扱い、浮動小数を使わない（CLAUDE.md「お金」）。
 * 率は分子・分母の整数で表す（例: 10.21% → 1021 / 10000）。
 */

export type Rounding = "floor" | "round" | "ceil";

export const ROUNDING_LABEL: Record<Rounding, string> = { floor: "切り捨て", round: "四捨五入", ceil: "切り上げ" };

/** 整数の割り算を端数処理する（num / den。den は正の数） */
export function divide(num: number, den: number, rounding: Rounding): number {
  if (!Number.isInteger(num) || !Number.isInteger(den) || den <= 0) throw new Error(`整数で計算してください: ${num} / ${den}`);
  const q = Math.floor(num / den);
  const r = num - q * den;
  if (r === 0) return q;
  if (rounding === "floor") return q;
  if (rounding === "ceil") return q + 1;
  return r * 2 >= den ? q + 1 : q;
}

/** 金額 × 率（分子 / 分母）を端数処理する */
export function applyRate(amount: number, numerator: number, denominator: number, rounding: Rounding): number {
  return divide(amount * numerator, denominator, rounding);
}

/** 合計（整数だけ） */
export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
