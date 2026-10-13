import Link from "next/link";
import { CompanyName } from "@/components/app/company-name";
import { Badge } from "@/components/ui/badge";
import { formatCount } from "@/lib/count";
import { parse, todayJst } from "@/lib/date";
import type { StatementsData } from "@/lib/data/statements";
import { formatYen, type Statement, statementNotes, statementTotals, withholdingLabels } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * ★ 支払明細書の紙面（Phase 13。いただいた書式: 一覧 ＋ 一人ずつの明細書）。
 * 画面ではカード、印刷（PDF に保存）では A4 1枚ずつになる。アプリの枠（メニューなど）は印刷しない
 */

const monthLabel = (month: string) => {
  const { y, m } = parse(`${month}-01`);
  return `${y}年${m}月分`;
};
const dateLabel = (date: string) => {
  const { y, m, d } = parse(date);
  return `${y}年${m}月${d}日`;
};
const unitText = (st: Statement) => (st.mainUnit ? `${formatYen(st.mainUnit.unit)}${st.mainUnit.others ? " ほか" : ""}` : "−");

function Provisional({ show }: { show: boolean }) {
  if (!show) return null;
  return <Badge tone="waiting">仮</Badge>;
}

/** 一覧（支払一覧表） */
export function SummarySheet({ data, linkable = true }: { data: StatementsData; linkable?: boolean }) {
  const t = statementTotals(data.statements);
  const provisional = !data.closed;
  const nameCell = (st: Statement) =>
    linkable ? (
      <Link href={`/money/statements/${st.staffId}?month=${data.month}`} className="text-primary underline-offset-2 hover:underline print:text-foreground print:no-underline">
        {st.name}
      </Link>
    ) : (
      st.name
    );
  return (
    <section aria-label="支払一覧表" className="mx-4 rounded-2xl border bg-card p-4 shadow-card print:mx-0 print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <h2 className="flex flex-wrap items-center gap-2 text-xl font-bold">
        支払一覧表 <Provisional show={provisional} />
      </h2>
      <p className="mt-1 flex flex-wrap justify-between gap-x-4 text-sm">
        <span>対象期間 {monthLabel(data.month)}</span>
        <CompanyName name={data.company.name} />
      </p>
      {provisional && <p className="mt-1 text-sm text-status-waiting">締め前の仮の金額です（実績の確定・締めのあとに変わることがあります）。</p>}

      {/* スマホの画面: 1人1枚のカード */}
      <ul className="mt-3 flex flex-col gap-2 md:hidden print:hidden">
        {data.statements.map((st) => (
          <li key={st.staffId} className="rounded-xl border p-3">
            <p className="flex items-center justify-between gap-2">
              <span className="font-bold">{nameCell(st)}</span>
              <span className="text-sm text-muted-foreground">{st.rankName ? `ランク${st.rankName}` : ""}</span>
            </p>
            <dl className="mt-1 grid grid-cols-2 gap-x-3 text-sm tabular-nums">
              <dt className="text-muted-foreground">単価（税込）× 稼働数</dt>
              <dd className="text-right">
                {unitText(st)} × {st.worked}
              </dd>
              <dt className="text-muted-foreground">合計（税込）</dt>
              <dd className="text-right">{formatYen(st.total)}</dd>
              <dt className="text-muted-foreground">源泉徴収税額</dt>
              <dd className="text-right">{formatYen(st.withholding)}</dd>
              <dt className="font-bold">お支払額</dt>
              <dd className="text-right font-bold">{formatYen(st.net)}</dd>
            </dl>
            {st.missingDailyRate && <p className="mt-1 text-sm text-status-alert">日当が決まっていない稼働があります（0円で計算）</p>}
          </li>
        ))}
        <li className="rounded-xl bg-muted p-3 text-sm tabular-nums">
          合計 {t.worked}稼働・お支払額 <b>{formatYen(t.net)}</b>（合計（税込）{formatYen(t.total)}・源泉 {formatYen(t.withholding)}）
        </li>
      </ul>

      {/* PC の画面と印刷: 表 */}
      <div className="mt-3 hidden overflow-x-auto md:block print:block">
        <table className="w-full text-sm tabular-nums print:text-xs">
          <thead>
            <tr className="border-b text-left">
              {["氏名", "ランク", "単価（税込）", "稼働数", "合計（税込）", "うち本体価格", "源泉徴収税額", "お支払額"].map((h, i) => (
                <th key={h} className={cn("px-2 py-1.5 font-semibold whitespace-nowrap", i >= 2 && "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.statements.map((st) => (
              <tr key={st.staffId} className="border-b">
                <td className="px-2 py-1.5 whitespace-nowrap">
                  {nameCell(st)}
                  {st.missingDailyRate && <span className="ml-1 text-status-alert print:hidden">（日当が未設定）</span>}
                </td>
                <td className="px-2 py-1.5">{st.rankName ?? ""}</td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">{unitText(st)}</td>
                <td className="px-2 py-1.5 text-right">{st.worked}</td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">{formatYen(st.total)}</td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">{formatYen(st.base)}</td>
                <td className="px-2 py-1.5 text-right whitespace-nowrap">{formatYen(st.withholding)}</td>
                <td className="px-2 py-1.5 text-right font-semibold whitespace-nowrap">{formatYen(st.net)}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className="px-2 py-1.5">合計</td>
              <td />
              <td />
              <td className="px-2 py-1.5 text-right">{t.worked}</td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap">{formatYen(t.total)}</td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap">{formatYen(t.base)}</td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap">{formatYen(t.withholding)}</td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap">{formatYen(t.net)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <Notes notes={statementNotes({ method: "fee", taxInclusive: data.settings.withholdingTaxInclusive, includeExpenses: data.settings.withholdingIncludeExpenses, taxRatePercent: data.settings.taxRatePercent })} />
    </section>
  );
}

function Notes({ notes }: { notes: string[] }) {
  return (
    <div className="mt-3 text-sm text-muted-foreground print:text-foreground">
      <p className="font-semibold">【前提条件】</p>
      <ul>
        {notes.map((n) => (
          <li key={n}>・{n}</li>
        ))}
      </ul>
    </div>
  );
}

/** 一人ずつの支払明細書 */
export function StatementSheet({ st, data, newPage = false }: { st: Statement; data: StatementsData; newPage?: boolean }) {
  const provisional = !data.closed || st.estimate;
  const s = data.settings;
  const wl = withholdingLabels(st.method, s.withholdingTaxInclusive);
  const row = (label: string, value: number, strong = false) => (
    <tr className={cn("border-b", strong && "text-lg font-bold")}>
      <th scope="row" className="px-2 py-1.5 text-left font-normal">
        <span className={cn(strong && "font-bold")}>{label}</span>
      </th>
      <td className="px-2 py-1.5 text-right whitespace-nowrap">{formatYen(value)}</td>
    </tr>
  );
  return (
    <section
      aria-label={`${st.name}さんの支払明細書`}
      className={cn(
        // 広い画面では A4 くらいの幅にそろえる
        "mx-4 rounded-2xl border bg-card p-4 shadow-card md:mx-auto md:w-[calc(100%-2rem)] md:max-w-3xl print:mx-0 print:w-full print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none",
        // 全員分を印刷するときは1人1枚ずつ
        newPage && "print:break-before-page",
      )}
    >
      <h2 className="flex flex-wrap items-center justify-center gap-2 text-center text-2xl font-bold tracking-[0.4em]">
        支払明細書 <Provisional show={provisional} />
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <dt className="text-muted-foreground print:text-foreground">支払先</dt>
          <dd className="font-bold">{st.name} 様</dd>
          <dt className="text-muted-foreground print:text-foreground">対象期間</dt>
          <dd>{monthLabel(data.month)}</dd>
          <dt className="text-muted-foreground print:text-foreground">発行日</dt>
          <dd>{dateLabel(todayJst())}</dd>
        </dl>
        <div className="text-sm sm:text-right">
          <p className="font-bold">
            <CompanyName name={data.company.name} />
          </p>
          {data.company.address && <p>{data.company.address}</p>}
          {data.company.phone && <p>{data.company.phone}</p>}
        </div>
      </div>
      {provisional && <p className="mt-2 text-sm text-status-waiting">締め前の仮の明細書です（実績の確定・締めのあとに金額が変わることがあります）。</p>}
      {st.missingDailyRate && <p className="mt-2 text-sm text-status-alert print:hidden">日当が決まっていない稼働があります（0円で計算しています）。ランクの基準日当か人ごとの日当を入れてください。</p>}

      {/* スマホの画面: 1行ずつ（項目の下に 単価 × 数量 ＝ 金額） */}
      <ul className="mt-3 border-t sm:hidden print:hidden">
        {st.lines.length === 0 && <li className="border-b px-2 py-2 text-muted-foreground">この月の稼働はありません</li>}
        {st.lines.map((l, i) => (
          <li key={i} className="border-b px-2 py-2">
            <p>{l.label}</p>
            <p className="flex justify-between gap-2 tabular-nums">
              <span className="text-muted-foreground">
                {formatYen(l.unit)} × {formatCount(l.qty)}
              </span>
              <span>{formatYen(l.amount)}</span>
            </p>
          </li>
        ))}
      </ul>

      {/* PC の画面と印刷: いただいた書式と同じ表 */}
      <table className="mt-3 hidden w-full table-fixed tabular-nums sm:table print:table">
        <colgroup>
          <col />
          <col className="w-[6.5rem]" />
          <col className="w-[3.5rem]" />
          <col className="w-[7rem]" />
        </colgroup>
        <thead>
          <tr className="border-b-2 text-sm">
            <th className="px-2 py-1.5 text-left font-semibold">項目</th>
            <th className="px-2 py-1.5 text-right font-semibold">単価（税込）</th>
            <th className="px-2 py-1.5 text-right font-semibold">数量</th>
            <th className="px-2 py-1.5 text-right font-semibold">金額（税込）</th>
          </tr>
        </thead>
        <tbody>
          {st.lines.length === 0 && (
            <tr className="border-b">
              <td colSpan={4} className="px-2 py-1.5 text-muted-foreground">
                この月の稼働はありません
              </td>
            </tr>
          )}
          {st.lines.map((l, i) => (
            <tr key={i} className="border-b align-top">
              <td className="px-2 py-1.5 break-words">{l.label}</td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap">{formatYen(l.unit)}</td>
              <td className="px-2 py-1.5 text-right">{formatCount(l.qty)}</td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap">{formatYen(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 合計から お支払額 まで（スマホでも同じ2列） */}
      <table className="w-full tabular-nums">
        <tbody>
          {row("合計（税込）", st.total)}
          {row("　うち 本体価格", st.base)}
          {row(`　うち 消費税（${s.taxRatePercent}%）`, st.tax)}
          {row(wl.base, st.withholdingBase)}
          {row(wl.amount, st.withholding)}
          {row("お支払額", st.net, true)}
        </tbody>
      </table>

      <div className="mt-3 text-sm">
        <p className="font-semibold">【設定】</p>
        <p>
          消費税率 {s.taxRatePercent}%・源泉徴収の控除額 {st.method === "sales_agent" ? "120,000円" : "0円"}・源泉徴収税率 {st.method === "none" ? "なし" : "10.21%"}
        </p>
      </div>
      <Notes notes={statementNotes({ method: st.method, taxInclusive: s.withholdingTaxInclusive, includeExpenses: s.withholdingIncludeExpenses, taxRatePercent: s.taxRatePercent })} />
    </section>
  );
}
