import Link from "next/link";
import { EmptyState } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { requireOwner } from "@/lib/auth";
import { formatShortJa } from "@/lib/date";
import { getMonthMoney } from "@/lib/data/money";
import { getMasters } from "@/lib/data/masters";
import { formatYen, type InvoiceLine } from "@/lib/money";
import { MoneyHeader, monthParam, StatTile } from "../money-header";

export const metadata = { title: "請求 | お金 | NICOLY CRM" };

/** ★ 請求（取引先別の請求額と、現場ごとの明細。月末締め） */
export default async function InvoicesPage({ searchParams }: PageProps<"/money/invoices">) {
  await requireOwner();
  const month = monthParam((await searchParams).month);
  const [money, masters] = await Promise.all([getMonthMoney(month), getMasters()]);
  const lineLabel = (l: InvoiceLine) =>
    l.kind === "person_day"
      ? `人日 ${masters.roleById.get(l.roleId)?.name ?? ""}`
      : l.kind === "item"
        ? `成果 ${masters.itemById.get(l.itemId)?.name ?? ""}`
        : l.kind === "event"
          ? "現場固定"
          : "交通費";

  const allEstimate = money.clients.length > 0 && money.clients.every((c) => c.estimateSubtotal > 0);

  return (
    <div className="flex flex-col gap-4 pb-8">
      <MoneyHeader month={month} current="/money/invoices" closing={money.closing} />
      {money.clients.length === 0 ? (
        <EmptyState title="この月の現場はありません">現場ができると、取引先ごとの請求額がここに出ます。</EmptyState>
      ) : (
        <>
          <div className="grid gap-3 px-4 sm:grid-cols-2">
            <StatTile
              label={`請求の合計（税込・${money.clients.length}社）`}
              value={formatYen(money.clients.reduce((a, c) => a + c.total, 0))}
              sub={<>税抜 {formatYen(money.clients.reduce((a, c) => a + c.subtotal, 0))}</>}
            />
            {/* 見込みを含むかは、全部のときはここで1回だけ言う（行ごとに同じ札を並べない） */}
            {allEstimate && (
              <p className="flex items-center gap-2 self-center text-sm text-muted-foreground">
                <Badge tone="waiting">見込みを含む</Badge>
                実績がまだ確定していない現場があります
              </p>
            )}
          </div>
          <ul className="flex flex-col gap-3 px-4">
            {money.clients.map((c) => (
              <li key={c.id} id={`c-${c.id}`} className="rounded-2xl border bg-card shadow-card">
                <details className="group">
                  <summary className="flex min-h-16 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 p-3">
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold">{c.name}</span>
                      <span className="block text-sm text-muted-foreground">
                        {c.events.filter((e) => !e.cancelled).length}現場
                        {c.estimateSubtotal > 0 && !allEstimate && <Badge tone="waiting" className="ml-2">見込みを含む</Badge>}
                        {c.missingRoles.length > 0 && <Badge tone="alert" className="ml-2">単価が未設定</Badge>}
                      </span>
                    </span>
                    <span className="text-right tabular-nums">
                      <span className="block text-lg font-bold">{formatYen(c.total)}</span>
                      <span className="block text-sm text-muted-foreground">
                        税抜 {formatYen(c.subtotal)} ＋ 消費税 {formatYen(c.tax)}
                      </span>
                    </span>
                  </summary>
                  <div className="border-t p-3">
                    <ul className="flex flex-col gap-3">
                      {c.events.map((e) => (
                        <li key={e.id}>
                          <p className="flex flex-wrap items-center gap-2">
                            <Link href={`/events/${e.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                              {formatShortJa(e.date)} {e.venueName}
                            </Link>
                            {e.cancelled ? <Badge tone="muted">中止</Badge> : e.status === "estimate" && <Badge tone="waiting">見込み</Badge>}
                            <span className="ml-auto font-bold tabular-nums">{formatYen(e.bill.subtotal)}</span>
                          </p>
                          {e.bill.lines.length > 0 && (
                            <ul className="mt-1 flex flex-col text-sm text-muted-foreground">
                              {e.bill.lines.map((l, i) => (
                                <li key={i} className="flex justify-between gap-2 tabular-nums">
                                  <span>
                                    {lineLabel(l)}
                                    {l.kind !== "transport" && l.kind !== "event" && ` ${formatYen(l.unit)} × ${l.qty}`}
                                    {l.unit === 0 && l.kind === "person_day" && <span className="ml-1 text-status-alert">（単価が未設定）</span>}
                                  </span>
                                  <span>{formatYen(l.amount)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-sm">
                      <Link href={`/sales/${c.id}`} className="text-primary underline-offset-2 hover:underline">
                        単価・請求設定を見る
                      </Link>
                    </p>
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
