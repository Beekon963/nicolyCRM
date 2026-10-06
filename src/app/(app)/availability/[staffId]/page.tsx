import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth";
import { monthOf, monthRange, nextMonth, todayJst } from "@/lib/date";
import { holidaysBetween } from "@/lib/date/holidays";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { AdminAvailability } from "./admin-availability";

export const metadata = { title: "稼働可能日の代理入力 | NICOLY CRM" };

export default async function AdminAvailabilityPage({ params, searchParams }: PageProps<"/availability/[staffId]">) {
  await requireMember();
  const { staffId } = await params;
  const thisMonth = monthOf(todayJst());
  const next = nextMonth(thisMonth);
  const sp = await searchParams;
  const month = sp.month === thisMonth ? thisMonth : next;
  const { start, end } = monthRange(month);
  const supabase = await createClient();
  const [{ data: staff }, { data: av }, { data: sub }] = await Promise.all([
    supabase.from("staff").select("id, name").eq("id", staffId).maybeSingle(),
    supabase.from("availability").select("date, status").eq("staff_id", staffId).gte("date", start).lte("date", end),
    supabase.from("availability_submissions").select("memo").eq("staff_id", staffId).eq("month", start).maybeSingle(),
  ]);
  if (!staff) notFound();
  return (
    <>
      <PageHeader title={`${staff.name}さんの稼働可能日`} description="代理入力" back={`/availability?month=${month}`} />
      <div className="mx-4 mb-3 flex gap-1 rounded-lg bg-muted p-1">
        {[thisMonth, next].map((mo) => (
          <Link
            key={mo}
            href={`/availability/${staffId}?month=${mo}`}
            className={cn("flex h-11 flex-1 items-center justify-center rounded-md", mo === month ? "bg-background font-bold shadow-sm" : "text-muted-foreground")}
          >
            {Number(mo.slice(5))}月
          </Link>
        ))}
      </div>
      <AdminAvailability
        key={month}
        staffId={staffId}
        month={month}
        initial={Object.fromEntries((av ?? []).map((a) => [a.date, a.status]))}
        memo={sub?.memo ?? ""}
        holidays={holidaysBetween(start, end)}
      />
    </>
  );
}
