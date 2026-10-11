import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getAppUser, requireMember } from "@/lib/auth";
import { addDays, formatShortJa, isDateString, todayJst } from "@/lib/date";
import { loadDailyReports } from "@/lib/data/daily-report";
import { renderReport } from "@/lib/report-format";
import { cn } from "@/lib/utils";
import { ReportText } from "./report-text";

export const metadata = { title: "日報 | 実績確認 | NICOLY CRM" };

/** その日の日報を、取引先ごとのフォーマットの文章にして LINE にコピーする */
export default async function DailyReportPage({ searchParams }: PageProps<"/results/daily">) {
  await requireMember();
  const sp = await searchParams;
  const today = todayJst();
  const date = typeof sp.date === "string" && isDateString(sp.date) ? sp.date : today;
  const [clients, me] = await Promise.all([loadDailyReports(date), getAppUser()]);
  const quick = [
    { label: "今日", value: today },
    { label: "昨日", value: addDays(today, -1) },
  ];

  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader title="日報" back="/results" description="集めた実績報告を、取引先ごとのフォーマットの文章にします。コピーして LINE に貼ってください。" />
      <div className="flex flex-wrap items-center gap-2 px-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/results/daily?date=${addDays(date, -1)}`} aria-label="前の日">
            <ChevronLeftIcon />
          </Link>
        </Button>
        <span className="min-w-28 text-center font-bold">{formatShortJa(date)}</span>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/results/daily?date=${addDays(date, 1)}`} aria-label="次の日">
            <ChevronRightIcon />
          </Link>
        </Button>
        {quick.map((q) => (
          <Link
            key={q.label}
            href={`/results/daily?date=${q.value}`}
            className={cn(
              "inline-flex h-11 items-center rounded-full border px-4",
              q.value === date ? "border-primary bg-brand-50 font-semibold text-primary" : "border-input text-muted-foreground",
            )}
          >
            {q.label}
          </Link>
        ))}
      </div>

      {clients.length === 0 ? (
        <EmptyState title="この日の現場はありません">日付を変えるか、現場の画面で現場を作ってください。</EmptyState>
      ) : (
        clients.map((c) => (
          <section key={c.id} className="mx-4 flex flex-col gap-3 rounded-lg border p-4">
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold">
              {c.name}
              <Badge tone={c.reported === c.total ? "done" : "waiting"}>
                報告 {c.reported}/{c.total}人
              </Badge>
            </h2>
            {c.reported < c.total && <p className="text-sm text-status-waiting">まだ報告していない人は「（未報告）」と出ます。報告が集まってからコピーしてください。</p>}
            {c.formats.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                使えるフォーマットがありません。
                {me?.role === "owner" ? (
                  <Link href="/settings/report-formats" className="ml-1 text-primary underline underline-offset-2">
                    設定 → 日報のフォーマット
                  </Link>
                ) : (
                  "オーナーに作ってもらってください。"
                )}
              </p>
            ) : (
              c.formats.map((f) => <ReportText key={f.id} title={f.name} text={renderReport(f, c.day)} />)
            )}
          </section>
        ))
      )}
    </div>
  );
}
