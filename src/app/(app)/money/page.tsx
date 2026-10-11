import { AlertTriangleIcon } from "lucide-react";
import Link from "next/link";
import { MoneyBars } from "@/components/app/money-bars";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireOwner } from "@/lib/auth";
import { parse } from "@/lib/date";
import { byVenue, getMonthMoney, getTarget, getTrend } from "@/lib/data/money";
import { getMasters } from "@/lib/data/masters";
import { formatYen, type Split } from "@/lib/money";
import { cn } from "@/lib/utils";
import { MoneyHeader, monthParam } from "./money-header";

export const metadata = { title: "お金 | NICOLY CRM" };

const total = (s: Split) => s.confirmed + s.estimate;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);

function Tile({ label, split, note }: { label: string; split: Split; note?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn("text-2xl font-bold tabular-nums", total(split) < 0 && "text-status-alert")}>{formatYen(total(split))}</p>
      <p className="text-sm text-muted-foreground tabular-nums">
        確定 {formatYen(split.confirmed)}
        {split.estimate !== 0 && <> ・ 見込み {formatYen(split.estimate)}</>}
      </p>
      {note}
    </div>
  );
}

/** 目標との比較（確定分の上に見込み分を重ねた横棒） */
function TargetMeter({ label, split, target }: { label: string; split: Split; target: number }) {
  const t = total(split);
  const w = (v: number) => `${Math.max(0, Math.min(100, (v / target) * 100))}%`;
  const reached = t >= target;
  return (
    <div className="flex flex-col gap-1">
      <p className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{label}</span>
        <span className="text-sm tabular-nums">
          目標 {formatYen(target)} ・ {pct(t, target)}%{reached && <Badge tone="done" className="ml-2">達成</Badge>}
        </span>
      </p>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${label} 目標の${pct(t, target)}%（確定${pct(split.confirmed, target)}%）`}>
        <span className="h-full rounded-l-full bg-[#2a78d6]" style={{ width: w(Math.max(0, split.confirmed)) }} />
        <span className="h-full bg-[repeating-linear-gradient(45deg,#2a78d6_0_2px,transparent_2px_5px)]" style={{ width: w(Math.max(0, split.estimate)) }} />
      </div>
    </div>
  );
}

/** ★ お金（月次集計）: 売上・支払・粗利（確定分と見込み分）、目標、12か月の推移、取引先別・会場別 */
export default async function MoneyPage({ searchParams }: PageProps<"/money">) {
  await requireOwner();
  const month = monthParam((await searchParams).month);
  const [money, trend, target, masters] = await Promise.all([getMonthMoney(month), getTrend(month), getTarget(month), getMasters()]);
  const { summary } = money;
  const margin = pct(total(summary.gross), total(summary.revenue));
  const missingRates = money.clients.filter((c) => c.missingRoles.length);
  const missingDaily = money.staff.filter((s) => s.missingDailyRate);
  const venues = byVenue(money).slice(0, 10);
  const label = (m: string) => `${parse(`${m}-01`).m}月`;

  return (
    <div className="flex flex-col gap-4 pb-8">
      <MoneyHeader month={month} current="/money" closing={money.closing} />

      <div className="grid gap-3 px-4 sm:grid-cols-3">
        <Tile label="売上（税抜）" split={summary.revenue} />
        <Tile label="支払（報酬＋交通費・経費）" split={summary.pay} />
        <Tile label="粗利" split={summary.gross} note={margin != null && <p className="text-sm text-muted-foreground">粗利率 {margin}%</p>} />
      </div>
      <p className="px-4 text-sm text-muted-foreground">
        「確定」は実績が確定した現場、「見込み」はまだの現場（確定人数 × 人日単価 ＋ 現場固定 ＋ 速報件数 × 成果単価）です。
      </p>

      {(missingRates.length > 0 || missingDaily.length > 0) && (
        <Card className="mx-4 border-status-alert/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-status-alert">
              <AlertTriangleIcon className="size-5" />
              単価・日当が決まっていないものがあります
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {missingRates.map((c) => (
              <Link key={c.id} href={`/sales/${c.id}`} className="flex min-h-11 items-center text-status-alert underline-offset-2 hover:underline">
                {c.name}: 人日単価が未設定（{c.missingRoles.map((r) => masters.roleById.get(r)?.name).join("・")}）
              </Link>
            ))}
            {missingDaily.map((s) => (
              <Link key={s.id} href={`/staff/${s.id}`} className="flex min-h-11 items-center text-status-alert underline-offset-2 hover:underline">
                {s.name}: 日当が未設定
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {target && (target.revenue != null || target.grossProfit != null) ? (
        <Card className="mx-4">
          <CardHeader>
            <CardTitle>目標との比較</CardTitle>
            <Link href="/settings/targets" className="text-sm text-primary">
              目標を変える
            </Link>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {target.revenue != null && <TargetMeter label="売上" split={summary.revenue} target={target.revenue} />}
            {target.grossProfit != null && <TargetMeter label="粗利" split={summary.gross} target={target.grossProfit} />}
          </CardContent>
        </Card>
      ) : (
        <p className="mx-4 text-sm text-muted-foreground">
          この月の目標はまだありません。
          <Link href="/settings/targets" className="text-primary underline-offset-2 hover:underline">
            設定 → 月次目標
          </Link>
          で入れると、ここで比べられます。
        </p>
      )}

      <Card className="mx-4">
        <CardContent className="flex flex-col gap-6 pt-4">
          <MoneyBars title="売上（税抜）の推移" points={trend.map((t) => ({ key: t.month, label: label(t.month), confirmed: t.revenue.confirmed, estimate: t.revenue.estimate, highlight: t.month === month }))} />
          <MoneyBars title="粗利の推移" points={trend.map((t) => ({ key: t.month, label: label(t.month), confirmed: t.gross.confirmed, estimate: t.gross.estimate, highlight: t.month === month }))} />
        </CardContent>
      </Card>

      <div className="grid gap-4 px-4 lg:grid-cols-2">
        <Breakdown title="取引先別" rows={money.clients.map((c) => ({ id: c.id, name: c.name, revenue: c.subtotal, gross: c.events.reduce((a, e) => a + e.gross, 0), href: `/money/invoices?month=${month}#c-${c.id}`, estimate: c.estimateSubtotal > 0 }))} />
        <Breakdown title="会場別（上位10）" rows={venues.map((v) => ({ id: v.id, name: v.name, revenue: v.revenue, gross: v.gross, href: `/venues/${v.id}` }))} />
      </div>
    </div>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { id: string; name: string; revenue: number; gross: number; href: string; estimate?: boolean }[] }) {
  return (
    <section className="rounded-lg border">
      <h2 className="border-b px-4 py-2 font-bold">{title}</h2>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">この月の現場はまだありません。</p>
      ) : (
        // スマホは名前の下に金額（桁の多い金額が途中で折り返さないように）、PC は3列
        <ul className="tabular-nums">
          <li aria-hidden className="hidden grid-cols-[minmax(0,1fr)_9rem_9rem] gap-3 border-b px-4 py-1 text-sm text-muted-foreground sm:grid">
            <span>名前</span>
            <span className="text-right">売上</span>
            <span className="text-right">粗利</span>
          </li>
          {rows.map((r) => (
            <li key={r.id} className="grid grid-cols-2 gap-x-3 border-b px-4 py-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_9rem_9rem] sm:items-center">
              <div className="col-span-2 min-w-0 sm:col-span-1">
                <Link href={r.href} className="text-primary underline-offset-2 hover:underline sm:block sm:truncate">
                  {r.name}
                </Link>
                {r.estimate && <span className="ml-2 text-xs whitespace-nowrap text-status-waiting sm:ml-0 sm:block">見込みを含む</span>}
              </div>
              <p className="whitespace-nowrap sm:text-right">
                <span className="mr-1 text-sm text-muted-foreground sm:sr-only">売上</span>
                {formatYen(r.revenue)}
              </p>
              <p className={cn("text-right whitespace-nowrap", r.gross < 0 && "text-status-alert")}>
                <span className="mr-1 text-sm text-muted-foreground sm:sr-only">粗利</span>
                {formatYen(r.gross)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
