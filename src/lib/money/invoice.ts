/**
 * 請求（取引先へ。要件 §4.9）
 * 請求額（税抜）＝ Σ（人日単価 × 実際に稼働した人数）＋ 現場固定 ＋ Σ（成果単価 × 件数）＋（交通費を請求する取引先なら承認済み交通費）
 * - 当日不稼働・キャンセルの人は人数に含めない（workers に入れない）
 * - 中止の現場は請求しない
 * - 件数: 確定分は確定件数、見込み分は速報件数（速報がなければ 0）
 */
import { applyRate, type Rounding, sum } from "./round";
import { findRate, type RateLayer, type RateTable } from "./rates";

export type CountBasis = "confirmed" | "estimate";

export type ItemCount = { itemId: string; confirmed: number | null; reported: number | null };

export type BillingEvent = {
  id: string;
  cancelled: boolean;
  /** 実際に稼働した人（確定のアサイン。当日不稼働・キャンセルは除く）の役割 */
  workers: { roleId: string }[];
  /** 獲得項目ごとの件数（その現場の全員の合計） */
  items: ItemCount[];
  /** 承認済みの交通費の合計 */
  transport: number;
};

export type InvoiceLine =
  | { kind: "person_day"; roleId: string; unit: number; qty: number; amount: number; layer: RateLayer | null }
  | { kind: "event"; unit: number; qty: 1; amount: number; layer: RateLayer | null }
  | { kind: "item"; itemId: string; unit: number; qty: number; amount: number; layer: RateLayer | null }
  | { kind: "transport"; unit: number; qty: 1; amount: number; layer: null };

export type EventBill = {
  lines: InvoiceLine[];
  subtotal: number;
  /** 請求に入れた交通費（粗利の計算で、売上と支払いで相殺する分） */
  billedTransport: number;
  /** 人が稼働したのに人日単価が決まっていない役割 */
  missingRoles: string[];
};

export function itemQty(i: ItemCount, basis: CountBasis): number {
  return (basis === "confirmed" ? i.confirmed : i.reported) ?? 0;
}

export function billEvent(ev: BillingEvent, rates: RateTable, opts: { billTransport: boolean; basis: CountBasis }): EventBill {
  if (ev.cancelled) return { lines: [], subtotal: 0, billedTransport: 0, missingRoles: [] };
  const lines: InvoiceLine[] = [];
  const missingRoles: string[] = [];

  const byRole = new Map<string, number>();
  for (const w of ev.workers) byRole.set(w.roleId, (byRole.get(w.roleId) ?? 0) + 1);
  for (const [roleId, qty] of byRole) {
    const r = findRate(rates, "per_person_day", roleId);
    if (!r) missingRoles.push(roleId);
    lines.push({ kind: "person_day", roleId, unit: r?.amount ?? 0, qty, amount: (r?.amount ?? 0) * qty, layer: r?.layer ?? null });
  }

  const fixed = findRate(rates, "per_event");
  if (fixed) lines.push({ kind: "event", unit: fixed.amount, qty: 1, amount: fixed.amount, layer: fixed.layer });

  for (const it of ev.items) {
    const qty = itemQty(it, opts.basis);
    if (!qty) continue;
    const r = findRate(rates, "per_item", it.itemId);
    // 成果単価のない項目は請求しない（取引先に成果単価がないのはふつうなので、足りない扱いにはしない）
    if (!r) continue;
    lines.push({ kind: "item", itemId: it.itemId, unit: r.amount, qty, amount: r.amount * qty, layer: r.layer });
  }

  const billedTransport = opts.billTransport ? ev.transport : 0;
  if (billedTransport) lines.push({ kind: "transport", unit: billedTransport, qty: 1, amount: billedTransport, layer: null });

  return { lines, subtotal: sum(lines.map((l) => l.amount)), billedTransport, missingRoles };
}

export type TaxSettings = { ratePercent: number; rounding: Rounding };

/** 月の請求額（取引先ごと）: 税抜の合計に消費税をかける */
export function invoiceTotals(subtotal: number, tax: TaxSettings): { subtotal: number; tax: number; total: number } {
  const t = applyRate(subtotal, tax.ratePercent, 100, tax.rounding);
  return { subtotal, tax: t, total: subtotal + t };
}
