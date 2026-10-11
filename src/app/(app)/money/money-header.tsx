import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { addDays, monthOf, nextMonth, parse, todayJst } from "@/lib/date";
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
] as const;

/** お金の画面の見出し・月の切り替え・タブ（★オーナーだけ） */
export function MoneyHeader({ month, current, actions }: { month: string; current: (typeof TABS)[number]["href"]; actions?: React.ReactNode }) {
  const { y, m } = parse(`${month}-01`);
  const prev = monthOf(addDays(`${month}-01`, -1));
  return (
    <>
      <PageHeader title="お金" description="オーナーだけが見られます" actions={actions} />
      <nav className="mx-4 mb-2 flex gap-1 rounded-lg bg-muted p-1" aria-label="お金の画面">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={`${t.href}?month=${month}`}
            aria-current={current === t.href ? "page" : undefined}
            className={cn("flex h-11 flex-1 items-center justify-center rounded-md text-base", current === t.href ? "bg-background font-bold shadow-sm" : "text-muted-foreground")}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="flex items-center justify-between px-4 pb-2">
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
    </>
  );
}
