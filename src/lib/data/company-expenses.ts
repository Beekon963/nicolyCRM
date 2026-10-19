import "server-only";
import { categoryChoices } from "@/lib/company-expenses";
import { monthRange } from "@/lib/date";
import { type CompanyExpenseSummary, summarizeCompanyExpenses } from "@/lib/money/company-expenses";
import { selectAll } from "@/lib/supabase/select-all";
import { createClient } from "@/lib/supabase/server";

/**
 * ★ 会社の経費（Phase 16）。金額があるのでオーナーだけ（画面は layout.tsx の requireOwner、DB は RLS で守る）。
 * 管理者の画面・検索・AI の道具・見るだけリンクには出さない
 */

export type CompanyExpense = {
  id: string;
  spentOn: string;
  paidBy: string | null;
  vendor: string;
  item: string;
  purpose: string;
  category: string;
  amount: number;
  attendees: string;
  memo: string;
  receiptPath: string | null;
  receiptUrl: string;
  voided: boolean;
};

/** 払った人の候補（オーナー。無効にした人・管理者は、前の経費の名前を出すためだけに残す） */
export type Payer = { id: string; name: string; active: boolean; owner: boolean };

const COLUMNS = "id, spent_on, paid_by, vendor, item, purpose, category, amount, attendees, memo, receipt_path, receipt_url, voided_at";

type Row = {
  id: string;
  spent_on: string;
  paid_by: string | null;
  vendor: string;
  item: string;
  purpose: string;
  category: string;
  amount: number;
  attendees: string;
  memo: string;
  receipt_path: string | null;
  receipt_url: string;
  voided_at: string | null;
};

const toExpense = (r: Row): CompanyExpense => ({
  id: r.id,
  spentOn: r.spent_on,
  paidBy: r.paid_by,
  vendor: r.vendor,
  item: r.item,
  purpose: r.purpose,
  category: r.category,
  amount: r.amount,
  attendees: r.attendees,
  memo: r.memo,
  receiptPath: r.receipt_path,
  receiptUrl: r.receipt_url,
  voided: r.voided_at != null,
});

export async function getPayers(): Promise<Payer[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("app_users").select("id, name, role, is_active").order("role").order("name");
  // オーナーを先に（経費を立て替えるのはオーナー）
  return (data ?? [])
    .sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner"))
    .map((u) => ({ id: u.id, name: u.name, active: u.is_active, owner: u.role === "owner" }));
}

/** 月の経費（取り消したものは除く。新しい日付が上）と合計 */
export async function getCompanyExpenseMonth(month: string): Promise<{ rows: CompanyExpense[]; summary: CompanyExpenseSummary }> {
  const supabase = await createClient();
  const { start, end } = monthRange(month);
  const rows = (
    await selectAll<Row>((from, to) =>
      supabase
        .from("company_expenses")
        .select(COLUMNS)
        .gte("spent_on", start)
        .lte("spent_on", end)
        .is("voided_at", null)
        .order("spent_on", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, to),
    )
  ).map(toExpense);
  return { rows, summary: summarizeCompanyExpenses(rows) };
}

/** 書き出し用: 期間の経費（取り消したものは除く。日付の古い順） */
export async function getCompanyExpensesBetween(start: string, end: string): Promise<CompanyExpense[]> {
  const supabase = await createClient();
  return (
    await selectAll<Row>((from, to) =>
      supabase
        .from("company_expenses")
        .select(COLUMNS)
        .gte("spent_on", start)
        .lte("spent_on", end)
        .is("voided_at", null)
        .order("spent_on")
        .order("created_at")
        .order("id")
        .range(from, to),
    )
  ).map(toExpense);
}

export async function getCompanyExpense(id: string): Promise<CompanyExpense | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("company_expenses").select(COLUMNS).eq("id", id).maybeSingle();
  return data ? toExpense(data) : null;
}

/** 領収書の写真を見るためのリンク（1時間だけ使える。オーナーだけが作れる） */
export async function receiptLink(path: string | null): Promise<string | null> {
  if (!path) return null;
  const supabase = await createClient();
  const { data } = await supabase.storage.from("receipts").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

/** 入力の候補: 区分（使った回数の多い順）・店（最近使った順） */
export async function getExpenseChoices(): Promise<{ categories: string[]; vendors: string[] }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_expenses")
    .select("category, vendor, item")
    .is("voided_at", null)
    .order("spent_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1000);
  const counts = new Map<string, number>();
  const vendors: string[] = [];
  for (const r of data ?? []) {
    const c = r.category.trim();
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    // 今のシートは「買ったもの」に店の名前が入っている行もあるので、店がなければ買ったものを候補にする
    const v = (r.vendor || r.item).trim();
    if (v && !vendors.includes(v) && vendors.length < 200) vendors.push(v);
  }
  return { categories: categoryChoices([...counts].map(([category, count]) => ({ category, count }))), vendors };
}
