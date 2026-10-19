import { notFound } from "next/navigation";
import { getAppUser } from "@/lib/auth";
import { toCsv } from "@/lib/csv";
import { getCompanyExpensesBetween, getPayers } from "@/lib/data/company-expenses";
import { monthRange } from "@/lib/date";
import { companyExpenseCsvRows } from "@/lib/export/company-expenses-csv";

/**
 * ★ 会社の経費の CSV（Phase 16。オーナーだけ。管理者・ログインしていない人には 404）。
 * ?month=2026-10 でその月、?year=2026 でその年の1月〜12月
 */
export async function GET(req: Request) {
  const user = await getAppUser();
  if (user?.role !== "owner") notFound();
  const url = new URL(req.url);
  const month = url.searchParams.get("month") ?? "";
  const year = url.searchParams.get("year") ?? "";
  let start: string;
  let end: string;
  let label: string;
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    ({ start, end } = monthRange(month));
    label = month;
  } else if (/^\d{4}$/.test(year)) {
    start = `${year}-01-01`;
    end = `${year}-12-31`;
    label = year;
  } else notFound();

  const [rows, payers] = await Promise.all([getCompanyExpensesBetween(start, end), getPayers()]);
  const name = (id: string | null) => (id ? (payers.find((p) => p.id === id)?.name ?? "") : "まだ決めていない");
  const body = toCsv(companyExpenseCsvRows(rows, name));
  // 日本語のファイル名は RFC 5987 の書き方で渡す（古いブラウザ用に英数字の名前も付ける）
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="nicoly-company-expenses-${label}.csv"; filename*=UTF-8''${encodeURIComponent(`会社の経費_${label}.csv`)}`,
      "cache-control": "no-store",
    },
  });
}
