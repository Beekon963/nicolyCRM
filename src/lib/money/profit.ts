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

/**
 * 月次目標との比較（画面の「目標との比較」用）。
 * - pct: 目標に対して何%か（1%未満切り捨て。マイナスのときは null = 「赤字」と出す）
 * - remaining: 目標まであと何円か（達成したら 0）
 * - reached: 目標に届いたか
 */
export function targetProgress(total: number, target: number): { pct: number | null; remaining: number; reached: boolean } {
  if (target <= 0) return { pct: null, remaining: 0, reached: total >= target };
  return {
    pct: total < 0 ? null : Math.floor((total * 100) / target),
    remaining: Math.max(0, target - total),
    reached: total >= target,
  };
}
