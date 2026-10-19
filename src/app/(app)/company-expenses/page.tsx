import { CameraIcon, ChevronLeftIcon, ChevronRightIcon, FileDownIcon, PlusIcon, UserIcon } from "lucide-react";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { expenseTitle } from "@/lib/company-expenses";
import { getCompanyExpenseMonth, getPayers } from "@/lib/data/company-expenses";
import { addDays, formatLongJa, monthOf, nextMonth, parse } from "@/lib/date";
import { formatYen } from "@/lib/money/format";
import { monthParam } from "../money/money-header";

export const metadata = { title: "会社の経費 | NICOLY CRM" };

/**
 * ★ 会社の経費（Phase 16。オーナーだけ）。月ごとの合計（今のシートの「合計金額・記録件数」）と、
 * 払った人ごと・区分ごとの合計、日付の新しい順の一覧
 */
export default async function CompanyExpensesPage({ searchParams }: PageProps<"/company-expenses">) {
  const month = monthParam((await searchParams).month);
  const [{ rows, summary }, payers] = await Promise.all([getCompanyExpenseMonth(month), getPayers()]);
  const payerName = (id: string | null) => (id ? (payers.find((p) => p.id === id)?.name ?? "（いない人）") : "まだ決めていない");
  const { y, m } = parse(`${month}-01`);
  const prev = monthOf(addDays(`${month}-01`, -1));
  const days = [...new Set(rows.map((r) => r.spentOn))];

  return (
    <>
      <PageHeader
        title="会社の経費"
        description="立て替えた経費の記録。オーナーだけが見られます"
        actionsBelow
        actions={
          <>
            <Button asChild>
              <Link href="/company-expenses/new">
                <PlusIcon />
                経費を入れる
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/company-expenses/import?month=${month}`}>
                <FileDownIcon />
                取り込み・書き出し
              </Link>
            </Button>
          </>
        }
      />

      <div className="flex items-center justify-between px-4 pb-2 md:justify-center md:gap-8">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/company-expenses?month=${prev}`}>
            <ChevronLeftIcon />
            前の月
          </Link>
        </Button>
        <span className="font-bold">
          {y}年{m}月
        </span>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/company-expenses?month=${nextMonth(month)}`}>
            次の月
            <ChevronRightIcon />
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="この月の経費はまだありません"
          action={
            <div className="flex flex-col items-center gap-2">
              <Button asChild>
                <Link href="/company-expenses/new">
                  <CameraIcon />
                  レシートを撮って入れる
                </Link>
              </Button>
              <Link href={`/company-expenses/import?month=${month}`} className="text-sm text-primary underline-offset-2 hover:underline">
                今のスプレッドシートから取り込む
              </Link>
            </div>
          }
        >
          レシートを撮ると、AI が日付・店・金額を読み取ります。前の月も見られます。
        </EmptyState>
      ) : (
        <>
          <section aria-label="この月の合計" className="mx-4 mb-4 flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-card">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-sm text-muted-foreground">合計（税込）</p>
              <p className="text-2xl font-bold tabular-nums">
                {formatYen(summary.total)}
                <span className="ml-2 text-base font-normal text-muted-foreground">{summary.count}件</span>
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Breakdown label="払った人ごと" groups={summary.byPayer.map((g) => ({ name: payerName(g.key), total: g.total, count: g.count }))} />
              <Breakdown label="区分ごと" groups={summary.byCategory.map((g) => ({ name: g.key || "区分なし", total: g.total, count: g.count }))} />
            </div>
          </section>

          <div className="flex flex-col gap-4 px-4 pb-8">
            {days.map((d) => (
              <section key={d} aria-label={formatLongJa(d)}>
                <h2 className="mb-1.5 text-sm font-semibold text-[#344054]">{formatLongJa(d)}</h2>
                <ul className="divide-y overflow-hidden rounded-2xl border bg-card shadow-card">
                  {rows
                    .filter((r) => r.spentOn === d)
                    .map((r) => {
                      const t = expenseTitle(r);
                      return (
                        <li key={r.id}>
                          <Link href={`/company-expenses/${r.id}`} className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-accent">
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className="font-semibold break-words">{t.title}</span>
                              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                                {r.category && <Badge>{r.category}</Badge>}
                                {t.sub && <span className="break-words">{t.sub}</span>}
                                <span className="inline-flex items-center gap-1">
                                  <UserIcon aria-label="払った人" className="size-3.5 shrink-0" />
                                  {payerName(r.paidBy)}
                                </span>
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-1.5 font-semibold tabular-nums">
                              {(r.receiptPath || r.receiptUrl) && <CameraIcon aria-label="領収書あり" className="size-4 text-muted-foreground" />}
                              {formatYen(r.amount)}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** 内わけ（金額の多い順）。名前と金額のあいだが離れすぎないよう、幅をおさえる */
function Breakdown({ label, groups }: { label: string; groups: { name: string; total: number; count: number }[] }) {
  return (
    <div>
      <p className="mb-1 text-sm font-semibold text-[#344054]">{label}</p>
      <dl className="flex flex-col gap-1">
        {groups.map((g) => (
          <div key={g.name} className="flex items-baseline justify-between gap-3">
            <dt className="min-w-0 break-words">{g.name}</dt>
            <dd className="shrink-0 tabular-nums">
              {formatYen(g.total)}
              <span className="ml-1.5 text-sm text-muted-foreground">{g.count}件</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
