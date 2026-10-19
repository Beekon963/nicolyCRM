/**
 * 会社の経費（Phase 16）の決まりごと。お金の計算（合計）は src/lib/money/company-expenses.ts。
 */

/** 文字数の上限（DB の check と同じ） */
export const EXPENSE_LIMITS = { vendor: 100, item: 200, purpose: 200, category: 30, attendees: 300, memo: 500, receiptUrl: 1000 } as const;

/** 金額の上限（DB の check と同じ。税込・円） */
export const EXPENSE_MAX_AMOUNT = 99_999_999;

/** 最初から出す区分（今のシートで使っているもの＋よくあるもの） */
export const DEFAULT_EXPENSE_CATEGORIES = ["飲食", "交通", "通信・ソフト", "消耗品・備品", "その他"] as const;
const OTHER = "その他";

/**
 * 区分のワンタップ候補。前に使った区分を使った回数の多い順に出し、最初からの区分を足す（「その他」はいつも最後）。
 * 決まった一覧にしないので、新しい区分は入力すると次から候補に出る
 */
export function categoryChoices(used: { category: string; count: number }[], limit = 12): string[] {
  const out: string[] = [];
  const add = (c: string) => {
    const t = c.trim();
    if (t && t !== OTHER && !out.includes(t)) out.push(t);
  };
  for (const u of [...used].sort((a, b) => b.count - a.count)) add(u.category);
  for (const c of DEFAULT_EXPENSE_CATEGORIES) add(c);
  return [...out.slice(0, limit - 1), OTHER];
}

/** 一覧の見出し（店・支払先。なければ買ったもの）と、その下の小さな説明 */
export function expenseTitle(e: { vendor: string; item: string }): { title: string; sub: string } {
  const vendor = e.vendor.trim();
  const item = e.item.trim();
  if (!vendor) return { title: item, sub: "" };
  return { title: vendor, sub: item };
}

const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();

/** 「同じ経費」かを見分ける印（取り込みで2回入れないように。払った人・日付・金額・店・買ったもの） */
export function expenseKey(e: { paidBy: string | null; spentOn: string; amount: number; vendor: string; item: string }): string {
  return [e.paidBy ?? "", e.spentOn, e.amount, norm(e.vendor), norm(e.item)].join("|");
}
