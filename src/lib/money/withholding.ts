/**
 * 源泉徴収（要件 §4.9）。1円未満切り捨て。
 * - なし
 * - 報酬・料金: 対象額 × 10.21%（同じ月の対象額が100万円を超える部分は 20.42%）
 * - 外交員報酬: （月の対象額 − 120,000円）× 10.21%（マイナスなら 0）
 * 税務上の扱いは税理士に確認のこと（設定画面にも表示する）。
 */

export type WithholdingMethod = "none" | "fee" | "sales_agent";

export const WITHHOLDING_LABEL: Record<WithholdingMethod, string> = {
  none: "なし",
  fee: "報酬・料金",
  sales_agent: "外交員報酬",
};

const FEE_LIMIT = 1_000_000;
const SALES_AGENT_DEDUCTION = 120_000;

export function withholdingAmount(method: WithholdingMethod, base: number): number {
  if (!Number.isInteger(base)) throw new Error(`対象額は整数（円）で渡してください: ${base}`);
  if (base <= 0 || method === "none") return 0;
  if (method === "fee") {
    if (base <= FEE_LIMIT) return Math.floor((base * 1021) / 10000);
    return Math.floor((FEE_LIMIT * 1021 + (base - FEE_LIMIT) * 2042) / 10000);
  }
  const over = base - SALES_AGENT_DEDUCTION;
  return over > 0 ? Math.floor((over * 1021) / 10000) : 0;
}
