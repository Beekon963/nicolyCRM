/**
 * 粗利（要件 §4.9）＝ 請求額（税抜）− 報酬支払額（税抜換算）− 請求しない交通費・経費
 * 請求に入れた交通費は、売上（請求額）と支払い（スタッフへの交通費）で同じ額になり相殺されるので、
 * 請求額から除いて計算する（そのままだと交通費が利益に見えてしまうため）。
 */
import { excludeTax } from "./pay";

export function grossProfit(p: {
  /** 請求額（税抜）。請求に入れた交通費を含む */
  invoiceSubtotal: number;
  /** 請求に入れた交通費 */
  billedTransport: number;
  /** 報酬（日当 ＋ インセンティブ ＋ 調整額。税込） */
  reward: number;
  /** 請求しない交通費・経費 */
  unbilledExpenses: number;
  taxRatePercent: number;
}): number {
  return p.invoiceSubtotal - p.billedTransport - excludeTax(p.reward, p.taxRatePercent) - p.unbilledExpenses;
}
