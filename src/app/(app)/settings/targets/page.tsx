import { PageHeader } from "@/components/app/page-header";
import { requireOwner } from "@/lib/auth";
import { monthOf, nextMonth, todayJst } from "@/lib/date";
import { createClient } from "@/lib/supabase/server";
import { TargetsForm } from "./targets-form";

export const metadata = { title: "月次目標 | 設定 | NICOLY CRM" };

/** ★ 月次目標（売上・粗利。オーナーだけ） */
export default async function TargetsPage() {
  await requireOwner();
  let m = monthOf(todayJst());
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    months.push(m);
    m = nextMonth(m);
  }
  const supabase = await createClient();
  const { data } = await supabase.from("monthly_targets").select("month, revenue, gross_profit").gte("month", `${months[0]}-01`).lte("month", `${months.at(-1)}-01`);
  const byMonth = new Map((data ?? []).map((t) => [t.month.slice(0, 7), t]));
  return (
    <>
      <PageHeader title="月次目標" description="お金の画面とホームで、目標との比較に使います" back="/settings" />
      <TargetsForm rows={months.map((mm) => ({ month: mm, revenue: byMonth.get(mm)?.revenue ?? null, grossProfit: byMonth.get(mm)?.gross_profit ?? null }))} />
    </>
  );
}
