import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/app/page-header";
import { PrintButton } from "@/components/app/print-button";
import { Button } from "@/components/ui/button";
import { getStatements } from "@/lib/data/statements";
import { MoneyHeader, monthParam } from "../money-header";
import { SummarySheet } from "./sheets";

export const metadata = { title: "支払明細書 | お金 | NICOLY CRM" };

/** ★ 支払明細書の一覧（Phase 13）。一人ずつの明細書へ。一覧・全員分を PDF に保存できる */
export default async function StatementsPage({ searchParams }: PageProps<"/money/statements">) {
  const month = monthParam((await searchParams).month);
  const data = await getStatements(month);
  return (
    <div className="flex flex-col gap-4 pb-8 print:gap-0 print:p-0">
      <div className="print:hidden">
        <MoneyHeader month={month} current="/money/payments" path="/money/statements" closing={data.closed ? "closed" : undefined} />
        <div className="flex flex-wrap items-center gap-2 px-4">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/money/payments?month=${month}`}>
              <ChevronLeftIcon />
              支払いへ
            </Link>
          </Button>
          {data.statements.length > 0 && (
            <>
              <Button asChild>
                <Link href={`/money/statements/all?month=${month}`}>全員分の明細書を開く</Link>
              </Button>
              <PrintButton variant="outline">一覧を PDF に保存</PrintButton>
            </>
          )}
        </div>
        <p className="px-4 pt-2 text-sm text-muted-foreground">
          名前を押すと一人ずつの明細書が開きます。「PDF に保存」で保存して、LINE などで送れます（スマホは共有 → PDF、PC は送信先「PDF に保存」）。
        </p>
      </div>
      {data.statements.length === 0 ? (
        <EmptyState title="この月の支払いはありません">確定した稼働があると、支払一覧表と明細書がここに出ます。</EmptyState>
      ) : (
        <SummarySheet data={data} />
      )}
    </div>
  );
}
