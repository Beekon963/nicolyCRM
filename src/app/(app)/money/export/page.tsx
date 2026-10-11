import { DownloadIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireOwner } from "@/lib/auth";
import { formatShortJa } from "@/lib/date";
import { getExportStatus } from "@/lib/data/exports";
import { formatYen } from "@/lib/money";
import { MoneyHeader, monthParam } from "../money-header";

export const metadata = { title: "書き出し | お金 | NICOLY CRM" };

function Download({ kind, month, children, disabled }: { kind: string; month: string; children: React.ReactNode; disabled?: boolean }) {
  if (disabled)
    return (
      <Button variant="outline" className="self-start" disabled>
        <DownloadIcon />
        {children}
      </Button>
    );
  return (
    <Button asChild variant="outline" className="self-start">
      <a href={`/money/export/file?kind=${kind}&month=${month}`}>
        <DownloadIcon />
        {children}
      </a>
    </Button>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mx-4 flex flex-col gap-2 rounded-2xl border bg-card p-4 shadow-card">
      <h2 className="font-bold">{title}</h2>
      {children}
    </section>
  );
}

/** ★ 書き出し（オーナーだけ）: 請求集計・支払明細の CSV、freee 取込用、振込データ（全銀）、全データ */
export default async function ExportPage({ searchParams }: PageProps<"/money/export">) {
  await requireOwner();
  const month = monthParam((await searchParams).month);
  const st = await getExportStatus(month);
  const closed = st.closing === "closed";
  const closeLink = (
    <Link href={`/money/closing?month=${month}`} className="text-primary underline underline-offset-2">
      締め
    </Link>
  );

  return (
    <div className="flex flex-col gap-4 pb-8">
      <MoneyHeader month={month} current="/money/export" closing={st.closing} />
      {!closed && (
        <p className="mx-4 rounded-md bg-status-waiting-bg px-3 py-2 text-sm">
          この月はまだ締めていません。請求集計・支払明細は、いまのデータでの金額（見込みを含む）で書き出します。freee と振込データは、{closeLink}で締めてから書き出せます。
        </p>
      )}

      <Card title="請求集計（CSV）">
        <p className="text-sm text-muted-foreground">取引先ごとの請求（税抜・消費税・税込）と、現場ごとの明細です。Excel で開けます。</p>
        <Download kind="invoices" month={month} disabled={st.invoices === 0}>
          {st.invoices === 0 ? "この月の請求はありません" : `請求集計をダウンロード（${st.invoices}社）`}
        </Download>
      </Card>

      <Card title="支払明細（CSV）">
        <p className="text-sm text-muted-foreground">スタッフごとの日当・インセンティブ・調整額・交通費経費・源泉・差引支払額と、現場ごとの明細です。</p>
        <Download kind="payments" month={month} disabled={st.staff === 0}>
          {st.staff === 0 ? "この月の支払いはありません" : `支払明細をダウンロード（${st.staff}人）`}
        </Download>
      </Card>

      <Card title="freee に取り込む（取引のインポート）">
        <p className="text-sm text-muted-foreground">
          請求は「収入」、報酬は「支出」（報酬・交通費経費・源泉の預り金）として、未決済で取り込みます。勘定科目・税区分は
          <Link href="/settings/money" className="mx-1 text-primary underline underline-offset-2">
            お金の設定
          </Link>
          で変えられます。
        </p>
        {closed && st.freeeSkipped.length > 0 && <p className="text-sm text-status-alert">差引支払額が0円以下のため入れない人: {st.freeeSkipped.join("・")}</p>}
        <Download kind="freee" month={month} disabled={!closed}>
          {closed ? "freee 用の CSV をダウンロード" : "締めてから書き出せます"}
        </Download>
      </Card>

      <Card title="振込データ（全銀フォーマット・総合振込）">
        <p className="text-sm text-muted-foreground">
          ネットバンキングの総合振込で読み込むファイルです。確定で未払いの人だけが入ります（振込指定日 {formatShortJa(st.payDate)}）。振り込んだら「支払い」で支払済みにしてください。
        </p>
        {st.zengin.senderProblems.length > 0 && (
          <p className="text-sm text-status-alert">
            振込元が足りません（{st.zengin.senderProblems.join("・")}）。
            <Link href="/settings/money" className="ml-1 text-primary underline underline-offset-2">
              お金の設定で入れる
            </Link>
          </p>
        )}
        {closed && st.zengin.problems.length > 0 && (
          <div className="flex flex-col gap-1 rounded-md bg-status-alert-bg p-3 text-sm">
            <p className="font-bold text-status-alert">口座の情報が足りないため入っていない人（{st.zengin.problems.length}人）</p>
            <ul className="flex flex-col gap-1">
              {st.zengin.problems.map((p) => (
                <li key={p.name}>
                  {p.name}: {p.problems.join("・")}
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground">スタッフの「お金・契約」で口座を入れると、ここに入ります。</p>
          </div>
        )}
        {closed && st.zengin.ready > 0 && (
          <p className="text-sm tabular-nums">
            {st.zengin.ready}人・合計 {formatYen(st.zengin.total)}
          </p>
        )}
        <Download kind="zengin" month={month} disabled={!closed || st.zengin.senderProblems.length > 0 || st.zengin.ready === 0}>
          {!closed ? "締めてから書き出せます" : st.zengin.ready === 0 ? "振込データに入れる人がいません" : "振込データをダウンロード"}
        </Download>
      </Card>

      <Card title="全データ（バックアップ）">
        <p className="text-sm text-muted-foreground">すべての表を CSV にして ZIP でまとめます（月に関係なく全部）。口座・金額が入るので、大切に保管してください。</p>
        <Download kind="backup" month={month}>
          全データをダウンロード
        </Download>
      </Card>
    </div>
  );
}
