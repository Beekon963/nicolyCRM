import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { PrintButton } from "@/components/app/print-button";
import { Button } from "@/components/ui/button";
import { getStatements } from "@/lib/data/statements";
import { monthParam } from "../../money-header";
import { StatementSheet, SummarySheet } from "../sheets";

export const metadata = { title: "支払明細書（全員分） | お金 | NICOLY CRM" };

/** ★ 一覧と全員分の明細書（Phase 13）。印刷すると1人1枚ずつになる */
export default async function AllStatementsPage({ searchParams }: PageProps<"/money/statements/all">) {
  const month = monthParam((await searchParams).month);
  const data = await getStatements(month);
  return (
    <div className="flex flex-col gap-4 py-4 print:gap-0 print:p-0">
      <div className="flex flex-wrap items-center gap-2 px-4 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/money/statements?month=${month}`}>
            <ChevronLeftIcon />
            支払一覧表へ
          </Link>
        </Button>
        <PrintButton>全員分を PDF に保存（{data.statements.length}人）</PrintButton>
      </div>
      <SummarySheet data={data} linkable={false} />
      {data.statements.map((st) => (
        <StatementSheet key={st.staffId} st={st} data={data} newPage />
      ))}
    </div>
  );
}
