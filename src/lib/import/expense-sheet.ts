import { EXPENSE_LIMITS, EXPENSE_MAX_AMOUNT, expenseKey } from "@/lib/company-expenses";
import { isDateString } from "@/lib/date";
import { parseYen } from "@/lib/money/format";

/**
 * 今の「経費記録」スプレッドシート（払った人ごとのシート）を読む（Phase 16）。
 * - 1シート = 1人。上のほうに「〇〇｜経費記録」の見出しと「合計金額（円）・記録件数」がある
 * - 列の名前の行（日付・購入したもの・サービス・購入先・支払先・用途・区分・金額（税込・円）・領収書URL・メモ・参加者）の下に、1件1行
 * - CSV で保存したものも、CRM から直接読んだもの（画面に見えている文字のまま）も同じ形
 */

export type SheetExpense = {
  /** シートの何行目か（1から） */
  line: number;
  spentOn: string;
  item: string;
  vendor: string;
  purpose: string;
  category: string;
  amount: number;
  receiptUrl: string;
  memo: string;
  attendees: string;
};

export type ExpenseSheet = {
  /** 見出しの名前（「山田｜経費記録」なら「山田」）。なければ空 */
  owner: string;
  rows: SheetExpense[];
  /** 読まなかった行（何行目か・理由） */
  warnings: string[];
  /** シートに書いてある合計金額・記録件数（読んだ結果と同じか確かめる用。なければ null） */
  sheetTotal: number | null;
  sheetCount: number | null;
};

export const NOT_EXPENSE_SHEET = "経費記録のシートではないようです。「日付」「金額（税込・円）」の列があるシートを選んでください";

/** 列の名前（どれかに当たればその列） */
const COLUMNS = {
  spentOn: ["日付", "購入日", "支払日", "使った日"],
  item: ["購入したもの・サービス", "購入したもの", "買ったもの", "品名", "内容"],
  vendor: ["購入先・支払先", "購入先", "支払先", "店", "店名", "店・支払先"],
  purpose: ["用途", "目的"],
  category: ["区分", "科目", "勘定科目"],
  amount: ["金額（税込・円）", "金額（税込）", "金額"],
  receiptUrl: ["領収書URL", "領収書のURL", "領収書", "領収書のリンク"],
  memo: ["メモ", "備考"],
  attendees: ["参加者", "同席者"],
} as const;
type Column = keyof typeof COLUMNS;

const key = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");
const clean = (s: string | undefined) => (s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();

/** 「2026/09/06」「2026-9-6」「2026年9月6日(土)」→ 2026-09-06。読めなければ null */
export function parseSheetDate(text: string): string | null {
  const m = text.normalize("NFKC").trim().match(/^(\d{4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})/);
  if (!m) return null;
  const d = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return isDateString(d) ? d : null;
}

export function readExpenseSheet(rows: string[][]): ExpenseSheet | null {
  const headerAt = rows.findIndex((r) => r.some((c) => key(c) === "日付") && r.some((c) => key(c).startsWith("金額")));
  if (headerAt < 0) return null;
  const header = rows[headerAt].map(key);
  const col = {} as Record<Column, number>;
  for (const [name, labels] of Object.entries(COLUMNS) as [Column, readonly string[]][]) {
    col[name] = labels.map(key).reduce((found, l) => (found >= 0 ? found : header.indexOf(l)), -1);
  }

  // 見出し（「山田｜経費記録」）と、シートの合計（「合計金額（円）」「記録件数」の下の行）
  let owner = "";
  let sheetTotal: number | null = null;
  let sheetCount: number | null = null;
  rows.slice(0, headerAt).forEach((r, i) => {
    for (const c of r) {
      const m = c.normalize("NFKC").trim().match(/^(.+?)\s*\|\s*経費記録/);
      if (m && !owner) owner = m[1].trim();
    }
    const t = r.findIndex((c) => key(c).startsWith("合計金額"));
    const n = r.findIndex((c) => key(c) === "記録件数");
    const below = rows[i + 1] ?? [];
    if (t >= 0) {
      const v = parseYen(below[t] ?? "");
      if (v != null && !Number.isNaN(v)) sheetTotal = v;
    }
    if (n >= 0) {
      const m = key(below[n] ?? "").match(/^(\d+)件?$/);
      if (m) sheetCount = Number(m[1]);
    }
  });

  const out: SheetExpense[] = [];
  const warnings: string[] = [];
  rows.slice(headerAt + 1).forEach((r, i) => {
    const line = headerAt + 2 + i;
    const get = (c: Column, max = Infinity) => (col[c] >= 0 ? clean(r[col[c]]).slice(0, max) : "");
    if (r.every((c) => !clean(c))) return;
    const dateText = get("spentOn");
    const spentOn = parseSheetDate(dateText);
    const amountText = get("amount");
    const amount = parseYen(amountText);
    const item = get("item", EXPENSE_LIMITS.item);
    const vendor = get("vendor", EXPENSE_LIMITS.vendor);
    const what = [dateText, vendor || item].filter(Boolean).join(" ");
    if (!spentOn) return void warnings.push(`${line}行目: 日付が読めないので入れません（${what || "日付なし"}）`);
    if (amount == null) return void warnings.push(`${line}行目: 金額がないので入れません（${what}）`);
    if (Number.isNaN(amount) || amount < 1 || amount > EXPENSE_MAX_AMOUNT) return void warnings.push(`${line}行目: 金額「${amountText}」が読めないので入れません（${what}）`);
    if (!item && !vendor) return void warnings.push(`${line}行目: 買ったもの・支払先がないので入れません（${what}）`);
    out.push({
      line,
      spentOn,
      item,
      vendor,
      purpose: get("purpose", EXPENSE_LIMITS.purpose),
      category: get("category", EXPENSE_LIMITS.category),
      amount,
      receiptUrl: get("receiptUrl", EXPENSE_LIMITS.receiptUrl),
      memo: get("memo", EXPENSE_LIMITS.memo),
      attendees: get("attendees", EXPENSE_LIMITS.attendees),
    });
  });
  return { owner, rows: out, warnings, sheetTotal, sheetCount };
}

/** 「まだ決めていない」にするシートの名前（今のシートの「未振分」など） */
const UNASSIGNED = ["未振分", "未振り分け", "未定", "不明", "まだ決めていない"];

/**
 * シートの名前（見出しかタブの名前）から、払った人を選ぶ。
 * - 「未振分」などは null（まだ決めていない）
 * - 名前に含まれる利用者が1人だけならその人（「山田」→「山田 太郎」）
 * - 分からなければ undefined（画面で選んでもらう）
 */
export function matchPayer(sheetName: string, users: { id: string; name: string }[]): string | null | undefined {
  const n = key(sheetName);
  if (!n) return undefined;
  if (UNASSIGNED.map(key).includes(n)) return null;
  const hits = users.filter((u) => {
    const name = key(u.name);
    return name === n || name.includes(n) || n.includes(name);
  });
  return hits.length === 1 ? hits[0].id : undefined;
}

/**
 * 取り込む行を決める。CRM にもう同じ経費（払った人・日付・金額・店・買ったもの）があれば、その数だけ入れない
 * （同じシートを2回取り込んでも増えない。同じ日に同じ店で同じ金額を2回使った行は、2行とも入る）
 */
export function planExpenseImport<T extends { paidBy: string | null; spentOn: string; amount: number; vendor: string; item: string }>(
  rows: T[],
  existingKeys: string[],
): { insert: T[]; skipped: number } {
  const left = new Map<string, number>();
  for (const k of existingKeys) left.set(k, (left.get(k) ?? 0) + 1);
  const insert: T[] = [];
  let skipped = 0;
  for (const r of rows) {
    const k = expenseKey(r);
    const n = left.get(k) ?? 0;
    if (n > 0) {
      left.set(k, n - 1);
      skipped += 1;
    } else insert.push(r);
  }
  return { insert, skipped };
}
