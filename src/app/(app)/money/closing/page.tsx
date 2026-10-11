import { CheckCircle2Icon, ChevronRightIcon, CircleAlertIcon, LockIcon, LockOpenIcon } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { requireOwner } from "@/lib/auth";
import { formatShortJa, formatTimeJst, monthOf, nextMonth, parse, todayJst, toJstDateString } from "@/lib/date";
import { getClosingChecklist, getClosingInfo, getMonthMoney } from "@/lib/data/money";
import { formatYen } from "@/lib/money";
import { cn } from "@/lib/utils";
import { MoneyHeader, monthParam } from "../money-header";
import { CloseMonthButton, UnlockMonthButton } from "./closing-actions";

export const metadata = { title: "締め | お金 | NICOLY CRM" };

const at = (iso: string) => {
  const d = new Date(iso);
  return `${formatShortJa(toJstDateString(d))} ${formatTimeJst(d)}`;
};
const ACTION = { close: "締めた", unlock: "ロックを解除した", reclose: "もう一度締めた" } as const;

/**
 * ★ 月次締め（オーナーだけ）。
 * チェックリスト → 締める（請求・支払い・月の数字を保存し、その月を変更できなくする）→ ロック解除（理由）→ もう一度締める。
 */
export default async function ClosingPage({ searchParams }: PageProps<"/money/closing">) {
  await requireOwner();
  const month = monthParam((await searchParams).month);
  const [info, money, check] = await Promise.all([getClosingInfo(month), getMonthMoney(month), getClosingChecklist(month)]);
  const closed = info.status === "closed";
  const ended = month < monthOf(todayJst());
  const next = parse(`${nextMonth(month)}-01`);
  const missingRoles = money.clients.filter((c) => c.missingRoles.length > 0);
  const missingDaily = money.staff.filter((s) => s.missingDailyRate);
  const items = [
    { label: "実績が未確定の現場", n: check.unconfirmedEvents, unit: "件", href: "/results" },
    { label: "未報告のアサイン", n: check.unreported, unit: "件", href: "/results" },
    { label: "未承認の交通費・経費", n: check.pendingExpenses, unit: "件", href: "/expenses" },
    { label: "人日単価が未設定の取引先", n: missingRoles.length, unit: "社", href: `/money/invoices?month=${month}` },
    { label: "日当が未設定のスタッフ", n: missingDaily.length, unit: "人", href: `/money/payments?month=${month}` },
  ] as const;
  const warnings = items.filter((i) => i.n > 0).map((i) => `${i.label}が${i.n}${i.unit}`);
  const paidCount = Object.values(money.payments).filter((p) => p.status === "paid").length;
  const lastUnlock = info.logs.find((l) => l.action === "unlock");
  const invoiceTotal = money.clients.reduce((a, c) => a + c.total, 0);
  const netTotal = money.staff.reduce((a, s) => a + s.totals.net, 0);

  return (
    <div className="flex flex-col gap-4 pb-8">
      <MoneyHeader month={month} current="/money/closing" closing={info.status} />

      <section
        className={cn(
          "mx-4 flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-card",
          closed && "border-status-done bg-status-done-bg",
          info.status === "unlocked" && "border-status-alert bg-status-alert-bg",
        )}
      >
        <h2 className="flex items-center gap-2 text-lg font-bold">
          {closed ? <LockIcon className="size-5 text-status-done" aria-hidden /> : <LockOpenIcon className={cn("size-5", info.status === "unlocked" ? "text-status-alert" : "text-muted-foreground")} aria-hidden />}
          {closed ? "締め済み" : info.status === "unlocked" ? "ロック解除中" : "まだ締めていません"}
        </h2>
        {closed && info.closedAt && (
          <p className="text-sm">
            {at(info.closedAt)}に{info.closedBy ?? "オーナー"}が締めました。この月の実績・単価・経費・現場は変更できません。
          </p>
        )}
        {info.status === "unlocked" && lastUnlock && (
          <p className="text-sm">
            理由: {lastUnlock.reason}（{at(lastUnlock.at)}・{lastUnlock.by ?? "オーナー"}）。直したら、もう一度締めてください。
          </p>
        )}
        {!closed && !ended && (
          <p className="text-sm text-muted-foreground">
            この月はまだ終わっていません。{next.y}年{next.m}月1日から締められます。
          </p>
        )}

        <dl className="grid grid-cols-1 gap-2 tabular-nums sm:grid-cols-2">
          <div className="rounded-md bg-background p-3">
            <dt className="text-sm text-muted-foreground">請求（{money.clients.length}社・税込）</dt>
            <dd className="text-lg font-bold">{formatYen(invoiceTotal)}</dd>
          </div>
          <div className="rounded-md bg-background p-3">
            <dt className="text-sm text-muted-foreground">支払い（{money.staff.length}人・差引支払額）</dt>
            <dd className="text-lg font-bold">{formatYen(netTotal)}</dd>
            {closed && (
              <dd className="text-sm text-muted-foreground">
                支払済 {paidCount}人 ・ 未払い {money.staff.length - paidCount}人
              </dd>
            )}
          </div>
        </dl>

        {closed ? (
          <div className="flex flex-wrap gap-2">
            <UnlockMonthButton month={month} />
          </div>
        ) : (
          <CloseMonthButton month={month} label={info.status === "unlocked" ? "もう一度締める" : "この月を締める"} warnings={warnings} disabled={!ended} />
        )}
      </section>

      {!closed && (
        <section className="mx-4 rounded-2xl border bg-card shadow-card">
          <h2 className="border-b px-4 py-2 font-bold">締める前のチェック</h2>
          <ul>
            {items.map((i) => (
              <li key={i.label} className="border-b last:border-b-0">
                {/* 未処理があるものは行ぜんたいを押せる（右の小さな数字だけでなく） */}
                {i.n > 0 ? (
                  <Link href={i.href} className="flex min-h-12 items-center gap-3 px-4 py-2 transition-colors hover:bg-accent">
                    <CircleAlertIcon className="size-5 shrink-0 text-status-alert" aria-hidden />
                    <span className="min-w-0 flex-1">{i.label}</span>
                    <Badge tone="alert" className="tabular-nums">
                      {i.n}
                      {i.unit}
                    </Badge>
                    <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                ) : (
                  <span className="flex min-h-12 items-center gap-3 px-4 py-2">
                    <CheckCircle2Icon className="size-5 shrink-0 text-status-done" aria-hidden />
                    <span className="min-w-0 flex-1">{i.label}</span>
                    <span className="whitespace-nowrap text-status-done">なし</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="px-4 py-2 text-sm text-muted-foreground">未処理があっても締められます（締めたあとでも、ロックを解除すれば直せます）。</p>
        </section>
      )}

      <section className="mx-4 rounded-2xl border bg-card shadow-card">
        <h2 className="border-b px-4 py-2 font-bold">締めの履歴</h2>
        {info.logs.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">まだありません。月が終わったら、上のチェックを確かめて締めてください。</p>
        ) : (
          <ul>
            {info.logs.map((l) => (
              <li key={`${l.at}-${l.action}`} className="border-b px-4 py-2 text-sm last:border-b-0">
                <span className="tabular-nums">{at(l.at)}</span> {l.by ?? "オーナー"}が{ACTION[l.action]}
                {l.reason && <span className="block text-muted-foreground">理由: {l.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
