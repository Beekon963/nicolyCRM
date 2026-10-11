import Link from "next/link";
import { EmptyState } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { requireOwner } from "@/lib/auth";
import { formatShortJa } from "@/lib/date";
import { getMonthMoney } from "@/lib/data/money";
import { getMasters } from "@/lib/data/masters";
import { formatYen, WITHHOLDING_LABEL } from "@/lib/money";
import { cn } from "@/lib/utils";
import { MoneyHeader, monthParam } from "../money-header";
import { AdjustmentForm, RemoveAdjustment } from "./adjustments";

export const metadata = { title: "支払い | お金 | NICOLY CRM" };

/** ★ 支払い（スタッフ別の報酬と明細。月末締め・翌月払い） */
export default async function PaymentsPage({ searchParams }: PageProps<"/money/payments">) {
  await requireOwner();
  const month = monthParam((await searchParams).month);
  const [money, masters] = await Promise.all([getMonthMoney(month), getMasters()]);
  const sum = (f: (s: (typeof money.staff)[number]) => number) => money.staff.reduce((a, s) => a + f(s), 0);

  return (
    <div className="flex flex-col gap-3 pb-8">
      <MoneyHeader month={month} current="/money/payments" />
      {money.staff.length === 0 ? (
        <EmptyState title="この月の稼働はありません">確定した稼働があると、スタッフごとの報酬がここに出ます。</EmptyState>
      ) : (
        <>
          <p className="px-4 text-sm text-muted-foreground tabular-nums">
            {money.staff.length}人 ・ 差引支払額の合計 {formatYen(sum((s) => s.totals.net))}（源泉 {formatYen(sum((s) => s.totals.withholding))}）
          </p>
          <ul className="flex flex-col gap-3 px-4">
            {money.staff.map((s) => (
              <li key={s.id} id={`s-${s.id}`} className="rounded-lg border">
                <details className="group">
                  <summary className="flex min-h-16 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 p-3">
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold">{s.name}</span>
                      <span className="flex flex-wrap gap-1 pt-0.5">
                        <Badge tone={s.invoiceRegistered ? "done" : "muted"}>{s.invoiceRegistered ? "インボイス登録あり" : "インボイス登録なし"}</Badge>
                        {s.method !== "none" && <Badge tone="muted">源泉: {WITHHOLDING_LABEL[s.method]}</Badge>}
                        {s.missingDailyRate && <Badge tone="alert">日当が未設定</Badge>}
                        {s.assignments.some((a) => a.status === "estimate") && <Badge tone="waiting">見込みを含む</Badge>}
                      </span>
                    </span>
                    <span className="text-right tabular-nums">
                      <span className={cn("block text-lg font-bold", s.totals.net < 0 && "text-status-alert")}>{formatYen(s.totals.net)}</span>
                      <span className="block text-sm text-muted-foreground">差引支払額</span>
                    </span>
                  </summary>
                  <div className="flex flex-col gap-3 border-t p-3">
                    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm tabular-nums sm:grid-cols-2 md:grid-cols-3">
                      {(
                        [
                          ["日当", s.totals.daily],
                          ["インセンティブ", s.totals.incentive],
                          ["調整額", s.totals.adjustment],
                          ["交通費・経費", s.totals.expense],
                          ["源泉徴収", -s.totals.withholding],
                          ["源泉の対象額", s.totals.withholdingBase],
                        ] as const
                      ).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">{k}</dt>
                          <dd>{formatYen(v)}</dd>
                        </div>
                      ))}
                    </dl>
                    <ul className="flex flex-col gap-1 text-sm">
                      {s.assignments.map((a) => (
                        <li key={a.assignmentId} className="flex flex-wrap justify-between gap-x-2 tabular-nums">
                          <Link href={`/events/${a.eventId}`} className="text-primary underline-offset-2 hover:underline">
                            {formatShortJa(a.date)} {a.venueName}
                            {a.status === "estimate" && <span className="ml-1 text-status-waiting">（見込み）</span>}
                          </Link>
                          <span className="text-muted-foreground">
                            日当 {formatYen(a.pay.daily)}
                            {a.pay.incentive > 0 && ` ＋ ${a.pay.lines.map((l) => `${masters.itemById.get(l.itemId)?.name ?? ""} ${l.qty}件`).join("・")} ${formatYen(a.pay.incentive)}`}
                            {a.expenses > 0 && ` ＋ 経費 ${formatYen(a.expenses)}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-col gap-2 border-t pt-3">
                      <p className="text-sm font-bold text-muted-foreground">調整額</p>
                      {s.adjustments.length === 0 && <p className="text-sm text-muted-foreground">なし</p>}
                      {s.adjustments.map((a) => (
                        <p key={a.id} className="flex items-center justify-between gap-2 text-sm tabular-nums">
                          <span>
                            {formatYen(a.amount)} <span className="text-muted-foreground">{a.reason}</span>
                          </span>
                          {a.id && <RemoveAdjustment id={a.id} />}
                        </p>
                      ))}
                      <AdjustmentForm staffId={s.id} month={month} />
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
