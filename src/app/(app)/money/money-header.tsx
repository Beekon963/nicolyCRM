import { ChevronLeftIcon, ChevronRightIcon, LockIcon, LockOpenIcon } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { addDays, monthOf, nextMonth, parse, todayJst } from "@/lib/date";
import type { ClosingStatus } from "@/lib/data/money";
import { cn } from "@/lib/utils";

/** URL の month（YYYY-MM）。なければ今月 */
export function monthParam(v: string | string[] | undefined): string {
  const s = typeof v === "string" ? v : "";
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? s : monthOf(todayJst());
}

const TABS = [
  { href: "/money", label: "月次集計" },
  { href: "/money/invoices", label: "請求" },
  { href: "/money/payments", label: "支払い" },
  { href: "/money/closing", label: "締め" },
  { href: "/money/export", label: "書き出し" },
] as const;

/** お金の画面の見出し・月の切り替え・タブ（★オーナーだけ） */
export function MoneyHeader({
  month,
  current,
  actions,
  closing,
}: {
  month: string;
  current: (typeof TABS)[number]["href"];
  actions?: React.ReactNode;
  /** 締めの状態（締め済み・ロック解除中のときに1行出す） */
  closing?: ClosingStatus;
}) {
  const { y, m } = parse(`${month}-01`);
  const prev = monthOf(addDays(`${month}-01`, -1));
  return (
    <>
      <PageHeader title="お金" description="オーナーだけが見られます" actions={actions} />
      <nav className="mx-4 mb-2 flex gap-1 rounded-xl bg-muted p-1" aria-label="お金の画面">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={`${t.href}?month=${month}`}
            aria-current={current === t.href ? "page" : undefined}
            className={cn("flex h-11 flex-1 items-center justify-center rounded-md text-base whitespace-nowrap", current === t.href ? "bg-background font-semibold text-foreground shadow-[0_1px_3px_rgb(16_24_40/0.1),0_1px_2px_rgb(16_24_40/0.06)]" : "text-muted-foreground")}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {/* スマホは両端、PC は真ん中にまとめる（広い画面で「前の月」と「次の月」が離れすぎないように） */}
      <div className="flex items-center justify-between px-4 pb-2 md:justify-center md:gap-8">
        <Button asChild variant="ghost" size="sm">
          <Link href={`${current}?month=${prev}`}>
            <ChevronLeftIcon />
            前の月
          </Link>
        </Button>
        <span className="font-bold">
          {y}年{m}月
        </span>
        <Button asChild variant="ghost" size="sm">
          <Link href={`${current}?month=${nextMonth(month)}`}>
            次の月
            <ChevronRightIcon />
          </Link>
        </Button>
      </div>
      {closing === "closed" && current !== "/money/closing" && current !== "/money/export" && (
        <p className="mx-4 mb-2 flex items-center gap-2 rounded-md bg-status-done-bg px-3 py-2 text-sm">
          <LockIcon className="size-4 shrink-0 text-status-done" aria-hidden />
          <span>
            締め済み（締めた時点の金額）。直すときは
            <Link href={`/money/closing?month=${month}`} className="mx-1 text-primary underline underline-offset-2">
              締め
            </Link>
            でロックを解除します。
          </span>
        </p>
      )}
      {closing === "unlocked" && current !== "/money/closing" && (
        <p className="mx-4 mb-2 flex items-center gap-2 rounded-md bg-status-alert-bg px-3 py-2 text-sm">
          <LockOpenIcon className="size-4 shrink-0 text-status-alert" aria-hidden />
          <span>
            ロック解除中（いまのデータで計算した金額）。直したら
            <Link href={`/money/closing?month=${month}`} className="mx-1 text-primary underline underline-offset-2">
              締め
            </Link>
            でもう一度締めてください。
          </span>
        </p>
      )}
    </>
  );
}

/**
 * お金の画面の大きな数字（月次集計・請求・支払いで同じ形）。いちばん大事な数字を大きく、内わけは小さく
 */
export function StatTile({ label, value, sub, alert }: { label: string; value: React.ReactNode; sub?: React.ReactNode; alert?: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border bg-card p-4 shadow-card">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={cn("text-2xl font-bold tabular-nums", alert && "text-status-alert")}>{value}</p>
      {sub && <div className="text-sm text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  );
}
