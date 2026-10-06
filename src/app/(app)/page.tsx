import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { StaffCount } from "@/app/(app)/events/event-list";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireMember } from "@/lib/auth";
import { formatShortJa, parse } from "@/lib/date";
import { getHomeData, getMonthRanking, type Ranking } from "@/lib/data/home";
import { formatTimeRange } from "@/lib/templates";
import { cn } from "@/lib/utils";

export const metadata = { title: "ホーム | NICOLY CRM" };

function Row({ href, children, alert }: { href: string; children: React.ReactNode; alert?: boolean }) {
  return (
    <li>
      <Link href={href} className={cn("flex min-h-12 items-center gap-2 py-2 hover:bg-accent", alert && "text-status-alert")}>
        <span className="min-w-0 flex-1">{children}</span>
        <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const user = await requireMember();
  const sp = await searchParams;
  const basis = sp.basis === "reported" ? "reported" : "confirmed";
  const [d, ranking] = await Promise.all([getHomeData(), getMonthRanking(basis)]);
  const overdueOffers = d.offers.filter((o) => o.overdue);
  const todo =
    d.shortages.length + d.offers.length + d.unreported.length + d.pendingExpenses + d.reminderPending.length + (d.availability.missing > 0 ? 1 : 0);

  return (
    <div className="flex flex-col gap-4 pb-6">
      <PageHeader title="ホーム" description={`${user.name}さん、おつかれさまです`} />

      {/* 1. 今日・明日の現場 */}
      <Card className="mx-4">
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
                      <span className="block truncate font-medium">{e.venue?.name}</span>
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

      {/* 2. 要対応 */}
      <Card className={cn("mx-4", todo > 0 && "border-status-alert/40")}>
        <CardHeader>
          <CardTitle>要対応</CardTitle>
          {todo === 0 && <Badge tone="done">対応が必要なものはありません</Badge>}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {d.shortages.length > 0 && (
            <div>
              <p className="text-sm font-bold text-status-alert">7日以内で欠員のある現場（{d.shortages.length}件）</p>
              <ul className="divide-y">
                {d.shortages.slice(0, 15).map((e) => (
                  <Row key={e.id} href={`/events/${e.id}/candidates`} alert>
                    {formatShortJa(e.date!)} {e.venue?.name} — 欠員 {e.shortage_total}人
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
              <p className={cn("text-sm font-bold", overdueOffers.length ? "text-status-alert" : "text-status-waiting")}>
                未回答の打診（{d.offers.length}件{overdueOffers.length > 0 && `、うち24時間以上 ${overdueOffers.length}件`}）
              </p>
              <ul className="divide-y">
                {d.offers.slice(0, 6).map((o) => (
                  <Row key={o.id} href={`/events/${o.event.id}`} alert={o.overdue}>
                    {o.staff?.name} — {formatShortJa(o.event.date)} {o.event.venue?.name}
                    {o.overdue && <Badge tone="alert" className="ml-2">24時間以上</Badge>}
                  </Row>
                ))}
              </ul>
            </div>
          )}
          {d.reminderPending.length > 0 && (
            <div>
              <p className="text-sm font-bold text-status-alert">明日の現場で前日リマインドを送っていない（{d.reminderPending.length}件）</p>
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
              <p className="text-sm font-bold text-status-alert">実績の未報告（{d.unreported.length}人）</p>
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
                <span className="font-bold text-status-waiting">未承認の交通費・経費 {d.pendingExpenses}件</span>
              </Row>
            </ul>
          )}
          {d.availability.missing > 0 && (
            <ul>
              <Row href={`/availability?month=${d.availability.month}`} alert={d.availability.late}>
                <span className={cn("font-bold", d.availability.late ? "text-status-alert" : "text-status-waiting")}>
                  {parse(`${d.availability.month}-01`).m}月分の稼働可能日 未提出 {d.availability.missing}人
                </span>
                <span className="ml-2 text-sm">（締切 {formatShortJa(d.availability.deadline)}{d.availability.late && " を過ぎています"}）</span>
              </Row>
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 5. 実績（今月の獲得件数トップ） */}
      <Card className="mx-4">
        <CardHeader>
          <CardTitle>今月の獲得件数</CardTitle>
          <div className="flex gap-1 rounded-md bg-muted p-1 text-sm">
            {(["confirmed", "reported"] as const).map((b) => (
              <Link key={b} href={b === "confirmed" ? "/" : "/?basis=reported"} className={cn("rounded px-3 py-1.5", basis === b ? "bg-background font-bold shadow-sm" : "text-muted-foreground")}>
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
                <span className="w-5 text-right text-sm text-muted-foreground">{i + 1}</span>
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
