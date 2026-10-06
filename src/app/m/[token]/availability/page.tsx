import Link from "next/link";
import { monthOf, monthRange, nextMonth, todayJst } from "@/lib/date";
import { holidaysBetween } from "@/lib/date/holidays";
import { callMypage } from "@/lib/mypage";
import { cn } from "@/lib/utils";
import { AvailabilityEditor } from "./availability-editor";

type Data = {
  month: string;
  today: string;
  deadline: string;
  memo: string;
  submitted_at: string | null;
  days: Record<string, "ok" | "maybe" | "ng">;
  events: Record<string, string>;
};

export default async function MypageAvailability({ params, searchParams }: PageProps<"/m/[token]/availability">) {
  const { token } = await params;
  const thisMonth = monthOf(todayJst());
  const next = nextMonth(thisMonth);
  const sp = await searchParams;
  const month = sp.month === thisMonth ? thisMonth : next; // 初期表示は翌月（提出してほしい月）
  const r = await callMypage<Data>("mypage_availability_get", { p_token: token, p_month: `${month}-01` });
  if (!r.ok) return <p className="text-status-alert">{r.error}</p>;
  const { start, end } = monthRange(month);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">稼働可能日</h1>
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        {[
          { m: thisMonth, label: "今月の残り" },
          { m: next, label: "翌月" },
        ].map((t) => (
          <Link
            key={t.m}
            href={`/m/${token}/availability?month=${t.m}`}
            className={cn("flex h-11 flex-1 items-center justify-center rounded-md", t.m === month ? "bg-background font-bold shadow-sm" : "text-muted-foreground")}
          >
            {t.label}（{Number(t.m.slice(5))}月）
          </Link>
        ))}
      </div>
      <AvailabilityEditor
        key={month}
        token={token}
        month={month}
        today={r.data.today}
        initial={r.data.days}
        memo={r.data.memo}
        submittedAt={r.data.submitted_at}
        deadline={r.data.deadline}
        holidays={holidaysBetween(start, end)}
        events={r.data.events}
      />
    </div>
  );
}
