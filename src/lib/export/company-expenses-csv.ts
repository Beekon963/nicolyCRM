/**
 * 会社の経費の CSV の中身（Phase 16。税理士さんなどに渡す用）。文字列にするのは src/lib/csv.ts の toCsv（UTF-8 BOM 付き）。
 * 1件1行で、今のスプレッドシートと同じ列に「払った人」を足した形。最後に合計の行（合計は src/lib/money の計算結果）
 */
import { summarizeCompanyExpenses } from "@/lib/money/company-expenses";

export const COMPANY_EXPENSE_HEADER = ["日付", "払った人", "区分", "店・支払先", "購入したもの・サービス", "用途", "参加者", "金額（税込・円）", "メモ", "領収書"];

export type ExpenseCsvRow = {
  spentOn: string;
  paidBy: string | null;
  category: string;
  vendor: string;
  item: string;
  purpose: string;
  attendees: string;
  amount: number;
  memo: string;
  receiptPath: string | null;
  receiptUrl: string;
};

/** 日付の古い順に並べる。領収書は、CRM に写真があれば「写真あり（CRM）」、今のシートから取り込んだものはそのリンク */
export function companyExpenseCsvRows(rows: ExpenseCsvRow[], payerName: (id: string | null) => string): (string | number)[][] {
  const sorted = [...rows].sort((a, b) => a.spentOn.localeCompare(b.spentOn));
  const s = summarizeCompanyExpenses(sorted);
  return [
    COMPANY_EXPENSE_HEADER,
    ...sorted.map((r) => [
      r.spentOn.replaceAll("-", "/"),
      payerName(r.paidBy),
      r.category,
      r.vendor,
      r.item,
      r.purpose,
      r.attendees,
      r.amount,
      r.memo,
      r.receiptPath ? "写真あり（CRM）" : r.receiptUrl,
    ]),
    ["合計", "", "", "", "", "", `${s.count}件`, s.total, "", ""],
  ];
}
