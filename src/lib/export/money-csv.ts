/**
 * 請求集計・支払明細の CSV の中身（行の2次元配列）。文字列にするのは src/lib/csv.ts の toCsv（UTF-8 BOM 付き）。
 * 金額は src/lib/money の計算結果をそのまま並べるだけで、ここでは計算しない（合計も計算結果の値を使う）。
 */
import type { ClientMoney, StaffMoney } from "@/lib/money";
import { WITHHOLDING_LABEL } from "@/lib/money/withholding";

export type Names = { role: (id: string) => string; item: (id: string) => string };
type PayState = { status: "unconfirmed" | "confirmed" | "paid"; paidOn: string | null };

const STATUS = { confirmed: "確定", estimate: "見込み" } as const;
const PAY_STATUS = { unconfirmed: "未確定", confirmed: "確定", paid: "支払済" } as const;

export const INVOICE_HEADER = ["取引先", "請求月", "日付", "会場", "内容", "単価", "数量", "金額（税抜）", "消費税", "税込", "状態"];

/** 取引先別の請求集計（現場ごとの明細の下に取引先の合計の行） */
export function invoiceCsvRows(month: string, clients: ClientMoney[], names: Names): (string | number)[][] {
  const rows: (string | number)[][] = [INVOICE_HEADER];
  for (const c of clients) {
    for (const e of c.events) {
      for (const l of e.bill.lines) {
        const what =
          l.kind === "person_day" ? `人日 ${names.role(l.roleId)}` : l.kind === "item" ? `成果 ${names.item(l.itemId)}` : l.kind === "event" ? "現場固定" : "交通費";
        rows.push([c.name, month, e.date, e.venueName, what, l.unit, l.qty, l.amount, "", "", STATUS[e.status]]);
      }
    }
    rows.push([c.name, month, "", "", "合計", "", "", c.subtotal, c.tax, c.total, c.estimateSubtotal > 0 ? "見込みを含む" : "確定"]);
  }
  return rows;
}

export const PAYMENT_HEADER = [
  "スタッフ",
  "対象月",
  "日付",
  "会場",
  "取引先",
  "内容",
  "日当",
  "インセンティブ",
  "調整額",
  "交通費・経費",
  "源泉徴収",
  "差引支払額",
  "インボイス登録",
  "源泉の方式",
  "状態",
  "支払日",
];

/** スタッフ別の支払明細（現場ごと・調整額ごとの行の下にスタッフの合計の行） */
export function paymentCsvRows(month: string, staff: StaffMoney[], states: Record<string, PayState>, names: Names): (string | number)[][] {
  const rows: (string | number)[][] = [PAYMENT_HEADER];
  for (const s of staff) {
    for (const a of s.assignments) {
      const items = a.pay.lines.filter((l) => l.qty > 0).map((l) => `${names.item(l.itemId)} ${l.qty}件`);
      const what = [`稼働 ${names.role(a.roleId)}`, ...items].join("・") + (a.status === "estimate" ? "（見込み）" : "");
      rows.push([s.name, month, a.date, a.venueName, a.clientName, what, a.pay.daily, a.pay.incentive, "", a.expenses, "", "", "", "", "", ""]);
    }
    for (const adj of s.adjustments) rows.push([s.name, month, "", "", "", `調整: ${adj.reason}`, "", "", adj.amount, "", "", "", "", "", "", ""]);
    const st = states[s.id];
    rows.push([
      s.name,
      month,
      "",
      "",
      "",
      "合計",
      s.totals.daily,
      s.totals.incentive,
      s.totals.adjustment,
      s.totals.expense,
      s.totals.withholding,
      s.totals.net,
      s.invoiceRegistered ? "あり" : "なし",
      WITHHOLDING_LABEL[s.method],
      PAY_STATUS[st?.status ?? "unconfirmed"],
      st?.paidOn ?? "",
    ]);
  }
  return rows;
}
