import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { StaffCount } from "@/app/(app)/events/event-list";
import { FillMeter } from "@/components/app/fill-meter";
import { PageHeader } from "@/components/app/page-header";
import { VenueColorDot } from "@/components/app/venue-color";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMember } from "@/lib/auth";
import { formatShortJa, monthOf, parse, todayJst } from "@/lib/date";
import { RecordActivityButton } from "@/components/app/activity-sheet";
import { listDueCompanies } from "@/lib/data/companies";
import { getMonthMoney, getTarget } from "@/lib/data/money";
import { formatYen } from "@/lib/money";
import { getHomeData, getMonthRanking, type Ranking } from "@/lib/data/home";
import { formatTimeRange } from "@/lib/templates";
import { cn } from "@/lib/utils";

export const metadata = { title: "ホーム | NICOLY CRM" };


function Row({ href, children, alert, bar = alert }: { href: string; children: React.ReactNode; alert?: boolean; bar?: boolean }) {
  return (
    <li>
      <Link
        href={href}
        data-alert={alert || undefined}
        className={cn(
          "relative -mx-2 flex min-h-12 items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-accent",
          // 要対応は文字を赤くせず、左の赤い縦線で知らせる（赤は札と線だけにして落ち着かせる）。「欠2」の札がある行は札だけ
          bar && "pl-4 before:absolute before:inset-y-2.5 before:left-1 before:w-[3px] before:rounded-full before:bg-status-alert-solid",
        )}
      >
        <span className="min-w-0 flex-1">{children}</span>
        <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}

/** 要対応の中の見出し。文字は濃いグレー、件数だけ状態の色の小さな札にする（赤い文字を並べない） */
function SubHead({ tone, children, count }: { tone: "alert" | "waiting"; children: React.ReactNode; count: string }) {
  return (
    <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold text-[#344054]">
      {children}
      <Badge tone={tone} className="tabular-nums">
        {count}
      </Badge>
    </p>
  );
}

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const user = await requireMember();
  const sp = await searchParams;
  const basis = sp.basis === "reported" ? "reported" : "confirmed";
  const isOwner = user.role === "owner";
  const thisMonth = monthOf(todayJst());
  // ★ 今月の数字はオーナーのときだけ取りに行く（管理者はデータ自体を取得しない。要件 §4.1）
  const [d, ranking, due, money, target] = await Promise.all([
    getHomeData(),
    getMonthRanking(basis),
    listDueCompanies(),
    isOwner ? getMonthMoney(thisMonth) : Promise.resolve(null),
    isOwner ? getTarget(thisMonth) : Promise.resolve(null),
  ]);
  const overdueOffers = d.offers.filter((o) => o.overdue);
  const todo =
    d.shortages.length + d.offers.length + d.unreported.length + d.pendingExpenses + d.reminderPending.length + (d.availability.missing > 0 ? 1 : 0);

  return (
    // スマホは1列（埋まり具合 → 今日・明日 → 要対応 → 営業 → 数字 → 獲得件数）。
    // PC は2列: 左に「要対応」（いちばん大事なので広く）、右に今日・明日・営業・数字
    <div className="flex flex-col gap-4 pb-6 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:px-4 lg:[&>*]:mx-0">
      <PageHeader title="ホーム" description={`${user.name}さん、おつかれさまです`} className="lg:col-span-2 lg:px-0" />

      {/* 0. 埋まり具合（ゲージ） */}
      <Card className="order-1 mx-4 lg:order-none lg:col-span-2 lg:row-start-2" data-testid="home-fill">
        <CardHeader>
          <CardTitle>埋まり具合</CardTitle>
          <Link href="/events/board" className="text-sm text-primary">
            稼働表
          </Link>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FillMeter label="明日" fill={d.fill.tomorrow} />
          <FillMeter label="明日から7日間" fill={d.fill.week} />
        </CardContent>
      </Card>

      {/* 左の列（PC）: 要対応。スマホでは display: contents で並び順（order）に従う */}
      <div className="contents lg:col-start-1 lg:row-start-3 lg:flex lg:flex-col lg:gap-4 [&>*]:mx-4 lg:[&>*]:mx-0">
      {/* 2. 要対応（スマホでは今日・明日の下） */}
      <Card className="order-3">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            要対応
            {todo > 0 && (
              <span className="grid h-6 min-w-6 place-items-center rounded-full bg-status-alert-solid px-2 text-sm font-bold text-white tabular-nums motion-safe:animate-pop">
                {todo}
              </span>
            )}
          </CardTitle>
          {todo === 0 && <Badge tone="done">対応が必要なものはありません</Badge>}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {d.shortages.length > 0 && (
            <div>
              <SubHead tone="alert" count={`${d.shortages.length}件`}>
                7日以内で欠員のある現場
              </SubHead>
              <ul className="divide-y">
                {d.shortages.slice(0, 15).map((e) => (
                  <Row key={e.id} href={`/events/${e.id}/candidates`} alert bar={false}>
                    {/* 日付は幅をそろえ、会場名は1行（どの行も同じ高さにする） */}
                    <span className="flex items-center gap-2">
                      <span className="w-[5.5rem] shrink-0 tabular-nums">{formatShortJa(e.date!)}</span>
                      <VenueColorDot color={e.venue?.color} />
                      <span className="min-w-0 flex-1 truncate">{e.venue?.name}</span>
                      <span className="shrink-0 rounded-full bg-status-alert-solid px-2 py-0.5 text-sm font-bold text-white tabular-nums">欠{e.shortage_total}</span>
                    </span>
                  </Row>
                ))}
              </ul>
              {d.shortages.length > 15 && (
                <Link href="/events?shortage=1" className="text-sm text-primary">
                  すべて見る
                </Link>
              )}
            </div>
          )}
          {d.offers.length > 0 && (
            <div>
              <SubHead tone={overdueOffers.length ? "alert" : "waiting"} count={overdueOffers.length > 0 ? `${d.offers.length}件（24時間以上 ${overdueOffers.length}件）` : `${d.offers.length}件`}>
                未回答の打診
              </SubHead>
              <ul className="divide-y">
                {d.offers.slice(0, 6).map((o) => (
                  <Row key={o.id} href={`/events/${o.event.id}`} alert={o.overdue} bar={false}>
                    {o.staff?.name} — {formatShortJa(o.event.date)} {o.event.venue?.name}
                    {o.overdue && <Badge tone="alert" className="ml-2">24時間以上</Badge>}
                  </Row>
                ))}
              </ul>
            </div>
          )}
          {d.reminderPending.length > 0 && (
            <div>
              <SubHead tone="alert" count={`${d.reminderPending.length}件`}>
                明日の現場で前日リマインドを送っていない
              </SubHead>
              <ul className="divide-y">
                {d.reminderPending.map((e) => (
                  <Row key={e.id} href={`/events/${e.id}`} alert>
                    {e.venue?.name} — 未送信 {e.reminder_pending}人
                  </Row>
                ))}
              </ul>
            </div>
          )}
          {d.unreported.length > 0 && (
            <div>
              <SubHead tone="alert" count={`${d.unreported.length}人`}>
                実績の未報告
              </SubHead>
              <ul className="divide-y">
                {d.unreported.slice(0, 6).map((a) => (
                  <Row key={a.id} href={`/events/${a.event.id}`} alert>
                    {a.staff?.name} — {formatShortJa(a.event.date)} {a.event.venue?.name}
                  </Row>
                ))}
              </ul>
              {d.unreported.length > 6 && (
                <Link href="/results" className="text-sm text-primary">
                  実績確認へ
                </Link>
              )}
            </div>
          )}
          {d.pendingExpenses > 0 && (
            <ul>
              <Row href="/expenses">
                <span className="flex flex-wrap items-center gap-2 font-semibold text-[#344054]">
                  未承認の交通費・経費
                  <Badge tone="waiting" className="tabular-nums">
                    {d.pendingExpenses}件
                  </Badge>
                </span>
              </Row>
            </ul>
          )}
          {d.availability.missing > 0 && (
            <ul>
              <Row href={`/availability?month=${d.availability.month}`} alert={d.availability.late}>
                <span className="flex flex-wrap items-center gap-2 font-semibold text-[#344054]">
                  {parse(`${d.availability.month}-01`).m}月分の稼働可能日 未提出
                  <Badge tone={d.availability.late ? "alert" : "waiting"} className="tabular-nums">
                    {d.availability.missing}人
                  </Badge>
                </span>
                <span className="block text-sm text-muted-foreground">
                  締切 {formatShortJa(d.availability.deadline)}
                  {d.availability.late && "（過ぎています）"}
                </span>
              </Row>
            </ul>
          )}
        </CardContent>
            </Card>
      </div>

      {/* 右の列（PC）: 今日・明日、営業、数字 */}
      <div className="contents lg:col-start-2 lg:row-start-3 lg:flex lg:flex-col lg:gap-4 [&>*]:mx-4 lg:[&>*]:mx-0">
      {/* 1. 今日・明日の現場 */}
      <Card className="order-2">
        <CardHeader>
          <CardTitle>今日・明日の現場</CardTitle>
          <Link href="/events" className="text-sm text-primary">
            現場一覧
          </Link>
        </CardHeader>
        <CardContent>
          {d.todayTomorrow.length === 0 ? (
            <p className="text-muted-foreground">今日・明日の現場はありません</p>
          ) : (
            <ul className="divide-y">
              {d.todayTomorrow.map((e) => (
                <li key={e.id}>
                  <Link href={`/events/${e.id}`} className="flex min-h-14 items-center gap-2 py-2 hover:bg-accent">
                    <Badge tone={e.date === d.today ? "brand" : "muted"}>{e.date === d.today ? "今日" : "明日"}</Badge>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 font-medium">
                        <VenueColorDot color={e.venue?.color} />
                        <span className="truncate">{e.venue?.name}</span>
                      </span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {formatTimeRange(e.start_time, e.end_time)}
                        {e.date === d.today && (e.unreported_count ?? 0) > 0 && ` / 未報告 ${e.unreported_count}人`}
                      </span>
                    </span>
                    <StaffCount e={e} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 3. 今日やること（営業）: 次回アクション日が今日以前の会社。期限切れは赤 */}
      <Card className="order-4">
        <CardHeader>
          <CardTitle>今日やること（営業）</CardTitle>
          <Link href="/sales?next=due" className="text-sm text-primary">
            営業へ
          </Link>
        </CardHeader>
        <CardContent>
          {due.length === 0 ? (
            <p className="text-muted-foreground">今日の予定はありません。会社に連絡したら「記録する」で次回アクション日を決めておくと、その日にここに出ます。</p>
          ) : (
            <ul className="divide-y">
              {due.slice(0, 10).map((c) => {
                const overdue = c.next_action_date! < d.today;
                return (
                  <li key={c.id} className="flex items-center gap-1">
                    <Link href={`/sales/${c.id}`} className="flex min-h-12 min-w-0 flex-1 flex-col justify-center gap-0.5 py-2 hover:bg-accent">
                      <span className="truncate font-medium">{c.name}</span>
                      {/* 会社名は赤くせず、期限切れ（赤）・今日（黄）は小さな札で */}
                      <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                        <Badge tone={overdue ? "alert" : "waiting"} className="shrink-0">
                          {overdue ? `期限切れ ${formatShortJa(c.next_action_date!)}` : "今日"}
                        </Badge>
                        <span className="truncate">
                          {c.next_action}
                          {c.owner && `（担当 ${c.owner.name}）`}
                        </span>
                      </span>
                    </Link>
                    <RecordActivityButton company={c} variant="outline" size="sm" label="記録" />
                  </li>
                );
              })}
            </ul>
          )}
          {due.length > 10 && (
            <Link href="/sales?next=due" className="text-sm text-primary">
              ほか {due.length - 10}社を見る
            </Link>
          )}
        </CardContent>
      </Card>

      {/* 4. 今月の数字（オーナーのみ） */}
      {money && (
        <Card className="order-5">
          <CardHeader>
            <CardTitle>今月の数字</CardTitle>
            <Link href="/money" className="text-sm text-primary">
              お金へ
            </Link>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-2 text-center">
            {(
              [
                ["売上（税抜）", money.summary.revenue, target?.revenue],
                ["支払", money.summary.pay, null],
                ["粗利", money.summary.gross, target?.grossProfit],
              ] as const
            ).map(([label, split, goal]) => {
              const t = split.confirmed + split.estimate;
              return (
                <div key={label} className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm text-muted-foreground">{label}</span>
                  <span className={cn("text-lg font-bold tabular-nums", t < 0 && "text-status-alert")}>{formatYen(t)}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">確定 {formatYen(split.confirmed)}</span>
                  {goal != null && goal > 0 && <span className="text-xs text-muted-foreground">目標の {Math.round((t / goal) * 100)}%</span>}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      </div>

      {/* 5. 実績（今月の獲得件数トップ） */}
      <Card className="order-6 mx-4 lg:order-none lg:col-span-2 lg:row-start-4">
        <CardHeader>
          <CardTitle>
            今月の獲得件数
            <Link href="/analysis" className="ml-2 text-sm font-normal text-primary">
              くわしく
            </Link>
          </CardTitle>
          <div className="flex gap-1 rounded-md bg-muted p-1 text-sm">
            {(["confirmed", "reported"] as const).map((b) => (
              <Link key={b} href={b === "confirmed" ? "/" : "/?basis=reported"} className={cn("rounded px-3 py-1.5", basis === b ? "bg-background font-semibold text-foreground shadow-[0_1px_3px_rgb(16_24_40/0.1),0_1px_2px_rgb(16_24_40/0.06)]" : "text-muted-foreground")}>
                {b === "confirmed" ? "確定" : "速報"}
              </Link>
            ))}
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <RankList title="スタッフ別" rows={ranking.staff} href={(id) => `/staff/${id}`} />
          <RankList title="会場別" rows={ranking.venues} href={(id) => `/venues/${id}`} />
          <RankList title="取引先別" rows={ranking.clients} href={(id) => `/sales/${id}`} />
        </CardContent>
      </Card>
    </div>
  );
}

function RankList({ title, rows, href }: { title: string; rows: Ranking; href: (id: string) => string }) {
  return (
    <div>
      <p className="mb-1 text-sm font-bold text-muted-foreground">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">まだありません</p>
      ) : (
        <ol className="flex flex-col">
          {rows.map((r, i) => (
            <li key={r.id}>
              <Link href={href(r.id)} className="flex min-h-10 items-center gap-2 hover:bg-accent">
                {/* 順位の丸（1位は塗りつぶし） */}
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full text-sm font-bold",
                    i === 0 ? "bg-primary text-primary-foreground" : i < 3 ? "bg-brand-50 text-primary" : "text-muted-foreground",
                  )}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <span className="font-bold">{r.total}件</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
