import { FileDownIcon } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { getPayers } from "@/lib/data/company-expenses";
import { parse } from "@/lib/date";
import { monthParam } from "../../money/money-header";
import { ExpenseImport } from "./expense-import";

export const metadata = { title: "経費の取り込み・書き出し | NICOLY CRM" };

/** ★ 会社の経費の取り込み（今のスプレッドシートから）・書き出し（CSV）。オーナーだけ（Phase 16） */
export default async function CompanyExpenseImportPage({ searchParams }: PageProps<"/company-expenses/import">) {
  const month = monthParam((await searchParams).month);
  const { y, m } = parse(`${month}-01`);
  const payers = (await getPayers()).filter((p) => p.owner && p.active);
  return (
    <>
      <PageHeader title="取り込み・書き出し" description="会社の経費" back={`/company-expenses?month=${month}`} />
      <div className="flex flex-col gap-6 px-4 pb-8">
        <section aria-labelledby="export-title" className="flex flex-col gap-2">
          <h2 id="export-title" className="text-lg font-bold">
            書き出す（CSV）
          </h2>
          <p className="text-sm text-muted-foreground">税理士さんなどに渡すときに。1件1行（日付・払った人・区分・店・買ったもの・用途・参加者・金額・メモ・領収書）で、最後に合計の行が入ります。</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <a href={`/company-expenses/export?month=${month}`} download>
                <FileDownIcon />
                {y}年{m}月の分
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={`/company-expenses/export?year=${y}`} download>
                <FileDownIcon />
                {y}年の1年分
              </a>
            </Button>
          </div>
        </section>

        <section aria-labelledby="import-title" className="flex flex-col gap-2">
          <h2 id="import-title" className="text-lg font-bold">
            今のスプレッドシートから取り込む
          </h2>
          <p className="text-sm text-muted-foreground">
            「〇〇｜経費記録」のシート（日付・購入したもの・サービス・購入先・支払先・用途・区分・金額・領収書URL・メモ・参加者）を読みます。シートの合計と同じか確かめてから取り込めます。同じシートをもう一度取り込んでも、同じ経費は増えません。
          </p>
          <ExpenseImport payers={payers.map((p) => ({ id: p.id, name: p.name }))} />
        </section>
      </div>
    </>
  );
}
