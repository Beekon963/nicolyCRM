import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/app/print-button";
import { Button } from "@/components/ui/button";
import { getStatements } from "@/lib/data/statements";
import { monthParam } from "../../money-header";
import { StatementSheet } from "../sheets";

export const metadata = { title: "支払明細書 | お金 | NICOLY CRM" };

/** ★ 一人の支払明細書（Phase 13）。PDF に保存して LINE などで送る */
export default async function StatementPage({ params, searchParams }: PageProps<"/money/statements/[staffId]">) {
  const { staffId } = await params;
  const month = monthParam((await searchParams).month);
  const data = await getStatements(month);
  const st = data.statements.find((s) => s.staffId === staffId);
  if (!st) notFound();
  return (
    <div className="flex flex-col gap-3 py-4 print:p-0">
      <div className="flex flex-wrap items-center gap-2 px-4 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/money/statements?month=${month}`}>
            <ChevronLeftIcon />
            支払一覧表へ
          </Link>
        </Button>
        <PrintButton />
      </div>
      <StatementSheet st={st} data={data} />
    </div>
  );
}
