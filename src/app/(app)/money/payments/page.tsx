import Link from "next/link";
import { EmptyState } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireOwner } from "@/lib/auth";
import { formatShortJa, paymentDateOf } from "@/lib/date";
import { getMonthMoney, getMoneySettings, type PaymentState } from "@/lib/data/money";
import { getMasters } from "@/lib/data/masters";
import { getReferralBonusTargets } from "@/lib/data/referrals";
import { formatYen, WITHHOLDING_LABEL } from "@/lib/money";
import { cn } from "@/lib/utils";
import { MoneyHeader, monthParam, StatTile } from "../money-header";
import { AddReferralBonus, AdjustmentForm, RemoveAdjustment } from "./adjustments";
import { PaidBar, PaidToggle } from "./paid";

export const metadata = { title: "支払い | お金 | NICOLY CRM" };

/** ★ 支払い（スタッフ別の報酬と明細。月末締め・翌月払い） */
export default async function PaymentsPage({ searchParams }: PageProps<"/money/payments">) {
  await requireOwner();
  const month = monthParam((await searchParams).month);
  const [money, masters, settings] = await Promise.all([getMonthMoney(month), getMasters(), getMoneySettings()]);
  const referrals = await getReferralBonusTargets(settings.referralBonus.after);
  const sum = (f: (s: (typeof money.staff)[number]) => number) => money.staff.reduce((a, s) => a + f(s), 0);
  const closed = money.closing === "closed";
  const payDate = paymentDateOf(month, settings.paymentDay);
  const stateOf = (id: string) => money.payments[id]?.status ?? "unconfirmed";
  const toPay = money.staff.filter((s) => stateOf(s.id) === "confirmed").map((s) => s.id);
  const hasEstimate = (s: (typeof money.staff)[number]) => s.assignments.some((a) => a.status === "estimate");
  // 全員が「未確定（見込みあり）」のときは、上で1回だけ言う（同じ札を全部の行に並べない）
  const allEstimate = money.staff.length > 0 && money.staff.every((s) => !money.payments[s.id] && hasEstimate(s));

  return (
    <div className="flex flex-col gap-4 pb-8">
      <MoneyHeader
        month={month}
        current="/money/payments"
        closing={money.closing}
        actions={
          <Button asChild size="sm">
            <Link href={`/money/statements?month=${month}`}>支払明細書（PDF）</Link>
          </Button>
        }
      />
      {referrals.length > 0 && (
        <section aria-label="友達紹介のボーナス" className="mx-4 flex flex-col gap-2 rounded-2xl border border-status-waiting/40 bg-status-waiting-bg p-4">
          <h2 className="font-bold">友達紹介のボーナス（{referrals.length}人）</h2>
          <p className="text-sm text-muted-foreground">
            紹介された人が{settings.referralBonus.after}回稼働しました。紹介した人の、この月の調整額に足せます（消せば元に戻ります）。
          </p>
          {settings.referralBonus.amount == null && (
            <p className="text-sm text-status-alert">
              <Link href="/settings/money" className="underline underline-offset-2">
                お金の設定
              </Link>
              でボーナスの額を入れてください。
            </p>
          )}
          <ul className="flex flex-col divide-y rounded-xl border bg-card">
            {referrals.map((r) => (
              <li key={r.staffId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0">
                  <span className="block font-medium">{r.referrerName}さん</span>
                  <span className="block text-sm text-muted-foreground">
                    紹介: {r.name}さん（{r.worked}回稼働{r.reachedOn && `・${settings.referralBonus.after}回目 ${formatShortJa(r.reachedOn)}`}）
                  </span>
                </span>
                {!closed && settings.referralBonus.amount != null && (
                  <AddReferralBonus referredStaffId={r.staffId} month={month} label={`${formatYen(settings.referralBonus.amount)}を足す`} />
                )}
              </li>
            ))}
          </ul>
          {closed && <p className="text-sm text-muted-foreground">この月は締め済みです。締めていない月の画面で足してください。</p>}
        </section>
      )}
      {money.staff.length === 0 ? (
        <EmptyState title="この月の稼働はありません">確定した稼働があると、スタッフごとの報酬がここに出ます。</EmptyState>
      ) : (
        <>
          <div className="grid gap-3 px-4 sm:grid-cols-2">
            <StatTile
              label={`差引支払額の合計（${money.staff.length}人）`}
              value={formatYen(sum((s) => s.totals.net))}
              sub={<>源泉 {formatYen(sum((s) => s.totals.withholding))}</>}
            />
            <StatTile label="支払日" value={formatShortJa(payDate)} />
          </div>
          {allEstimate && (
            <p className="flex items-center gap-2 px-4 text-sm text-muted-foreground">
              <Badge tone="waiting">未確定（見込みあり）</Badge>
              全員まだ確定していません（実績が確定していない稼働を含みます）
            </p>
          )}
          {closed ? (
            <PaidBar month={month} staffIds={toPay} defaultDate={payDate} />
          ) : (
            <p className="px-4 text-sm text-muted-foreground">
              月が終わったら
              <Link href={`/money/closing?month=${month}`} className="mx-1 text-primary underline underline-offset-2">
                締め
              </Link>
              で締めると「確定」になり、支払済みにできます。
            </p>
          )}
          <ul className="flex flex-col gap-3 px-4">
            {money.staff.map((s) => (
              <li key={s.id} id={`s-${s.id}`} className="rounded-2xl border bg-card shadow-card">
                <details className="group">
                  <summary className="flex min-h-16 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 p-3">
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold">{s.name}</span>
                      {/* 状態の札は1つだけ（未確定・確定・支払済）。インボイス・源泉は札にせず小さな文字で */}
                      <span className="flex flex-wrap items-center gap-1 pt-0.5">
                        {!allEstimate && <PayStatus state={money.payments[s.id]} estimate={hasEstimate(s)} />}
                        {s.missingDailyRate && <Badge tone="alert">日当が未設定</Badge>}
                        {s.missingTravelRate && <Badge tone="alert">遠方の額が未設定</Badge>}
                      </span>
                      <span className="block pt-0.5 text-sm text-muted-foreground">
                        {[s.invoiceRegistered ? "インボイス登録あり" : "インボイス登録なし", s.method !== "none" && `源泉 ${WITHHOLDING_LABEL[s.method]}`].filter(Boolean).join("・")}
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
                            {a.pay.travel > 0 && `（うち遠方 ${formatYen(a.pay.travel)}）`}
                            {a.pay.incentive > 0 && ` ＋ ${a.pay.lines.map((l) => `${masters.itemById.get(l.itemId)?.name ?? ""} ${l.qty}件`).join("・")} ${formatYen(a.pay.incentive)}`}
                            {a.expenses > 0 && ` ＋ 経費 ${formatYen(a.expenses)}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-col gap-2 border-t pt-3">
                      <p className="text-sm font-bold text-muted-foreground">調整額</p>
                      {s.adjustments.length === 0 && <p className="text-sm text-muted-foreground">なし</p>}
                      {s.adjustments.map((a, i) => (
                        <p key={a.id ?? i} className="flex min-h-11 items-center justify-between gap-2 text-sm tabular-nums">
                          <span>
                            {formatYen(a.amount)} <span className="text-muted-foreground">{a.reason}</span>
                          </span>
                          {a.id && !closed && <RemoveAdjustment id={a.id} />}
                        </p>
                      ))}
                      {closed ? (
                        <p className="text-sm text-muted-foreground">締め済みのため、調整額は変えられません。差額は翌月の調整額で精算してください。</p>
                      ) : (
                        <AdjustmentForm staffId={s.id} month={month} />
                      )}
                    </div>
                    {closed && stateOf(s.id) !== "unconfirmed" && (
                      <div className="border-t pt-3">
                        <PaidToggle month={month} staffId={s.id} paid={stateOf(s.id) === "paid"} defaultDate={payDate} />
                      </div>
                    )}
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

/** 支払いの状態: 未確定（締める前）→ 確定（締めたとき）→ 支払済（支払日） */
function PayStatus({ state, estimate }: { state: PaymentState | undefined; estimate?: boolean }) {
  if (state?.status === "paid") return <Badge tone="done">支払済{state.paidOn ? ` ${formatShortJa(state.paidOn)}` : ""}</Badge>;
  if (state?.status === "confirmed") return <Badge tone="waiting">確定（未払い）</Badge>;
  return <Badge tone={estimate ? "waiting" : "muted"}>{estimate ? "未確定（見込みあり）" : "未確定"}</Badge>;
}
