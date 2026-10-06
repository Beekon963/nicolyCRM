import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ExpenseList, type ExpenseRow } from "./expense-list";

export const metadata = { title: "交通費・経費の承認 | NICOLY CRM" };

const TABS = [
  { value: "pending", label: "未承認" },
  { value: "approved", label: "承認済み" },
  { value: "rejected", label: "却下" },
] as const;

export default async function ExpensesPage({ searchParams }: PageProps<"/expenses">) {
  await requireMember();
  const sp = await searchParams;
  const status = TABS.find((t) => t.value === sp.status)?.value ?? "pending";
  const supabase = await createClient();
  const { data } = await supabase
    .from("expenses")
    .select("id, kind, amount, memo, status, source, reject_reason, created_at, staff:staff(id, name), assignment:assignments(event:events(id, date, venue:venues(name)))")
    .eq("status", status)
    .order("created_at", { ascending: status === "pending" })
    .limit(200);
  const rows: ExpenseRow[] = (data ?? []).map((e) => ({
    id: e.id,
    kind: e.kind,
    amount: e.amount,
    memo: e.memo,
    status: e.status,
    source: e.source,
    reject_reason: e.reject_reason,
    staff: e.staff,
    event: e.assignment?.event ? { id: e.assignment.event.id, date: e.assignment.event.date, venue: e.assignment.event.venue?.name ?? "" } : null,
  }));

  return (
    <>
      <PageHeader title="交通費・経費の承認" description="スタッフが実績報告で申請した交通費・経費" />
      <div className="mx-4 mb-3 flex gap-1 rounded-lg bg-muted p-1">
        {TABS.map((t) => (
          <Link
            key={t.value}
            href={`/expenses?status=${t.value}`}
            className={cn("flex h-11 flex-1 items-center justify-center rounded-md", t.value === status ? "bg-background font-bold shadow-sm" : "text-muted-foreground")}
          >
            {t.label}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title={status === "pending" ? "未承認の申請はありません" : "該当する申請はありません"} />
      ) : (
        <ExpenseList rows={rows} />
      )}
    </>
  );
}
