import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { analyze, type AnalysisGroup, type Basis, type GroupBy, RANGE_LABEL, type RangeKey, rangeOf } from "@/lib/analysis";
import { requireMember } from "@/lib/auth";
import { formatShortJa, todayJst } from "@/lib/date";
import { loadResultRows } from "@/lib/data/analysis";
import { getMasters } from "@/lib/data/masters";
import { pickParams } from "@/lib/params";
import { cn } from "@/lib/utils";

export const metadata = { title: "実績の分析 | NICOLY CRM" };

const BY_LABEL: Record<GroupBy, string> = { staff: "スタッフ別", venue: "会場別", client: "取引先別" };
const HREF: Record<GroupBy, (id: string) => string> = {
  staff: (id) => `/staff/${id}`,
  venue: (id) => `/venues/${id}`,
  client: (id) => `/sales/${id}`,
};

/** 実績ランキングと会場別・取引先別の分析（要件 Phase 2）。金額は出さない */
export default async function AnalysisPage({ searchParams }: PageProps<"/analysis">) {
  await requireMember();
  const p = pickParams(await searchParams, ["range", "basis", "by", "sort"]);
  const range: RangeKey = p.range && p.range in RANGE_LABEL ? (p.range as RangeKey) : "month";
  const basis: Basis = p.basis === "reported" ? "reported" : "confirmed";
  const by: GroupBy = p.by === "venue" || p.by === "client" ? p.by : "staff";
  const sort = p.sort === "avg" ? "avg" : "total";
  const today = todayJst();
  const { start, end } = rangeOf(range, today);
  const [rows, masters] = await Promise.all([loadResultRows(start, end), getMasters()]);
  const groups = analyze(rows, by, basis);
  if (sort === "avg") groups.sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || b.counted - a.counted);
  const items = masters.items.filter((i) => i.is_active || groups.some((g) => g.byItem[i.id]));
  const sum = groups.reduce((s, g) => s + g.total, 0);

  const href = (changes: Partial<Record<"range" | "basis" | "by" | "sort", string | null>>) => {
    const next = new URLSearchParams(p);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const q = next.toString();
    return q ? `/analysis?${q}` : "/analysis";
  };
  const seg = <T extends string>(label: string, options: [T, string][], current: T, key: "range" | "basis" | "by" | "sort", def: T) => (
    <div role="group" aria-label={label} className="flex w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1 text-sm sm:w-fit">
      {options.map(([v, l]) => (
        <Link
          key={v}
          href={href({ [key]: v === def ? null : v })}
          aria-current={current === v ? "page" : undefined}
          className={cn("flex h-10 flex-1 items-center justify-center rounded-md px-3 whitespace-nowrap sm:flex-none", current === v ? "bg-background font-bold shadow-sm" : "text-muted-foreground")}
        >
          {l}
        </Link>
      ))}
    </div>
  );
  const pending = (g: AnalysisGroup) => g.worked - g.counted;

  return (
    <div className="flex flex-col gap-3 pb-8">
      <PageHeader title="実績の分析" description={`${formatShortJa(start)}〜${formatShortJa(end)}・獲得件数 ${sum}件（${basis === "confirmed" ? "確定" : "速報"}）`} />
      <div className="flex flex-col gap-2 px-4">
        {seg("期間", (Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => [k, RANGE_LABEL[k]]), range, "range", "month")}
        <div className="flex flex-wrap gap-2">
          {seg("集計のもと", [["confirmed", "確定"], ["reported", "速報"]] as [Basis, string][], basis, "basis", "confirmed")}
          {seg("並び", [["total", "獲得件数の順"], ["avg", "1稼働あたりの順"]] as ["total" | "avg", string][], sort, "sort", "total")}
        </div>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {(Object.keys(BY_LABEL) as GroupBy[]).map((k) => (
            <Link
              key={k}
              href={href({ by: k === "staff" ? null : k })}
              aria-current={by === k ? "page" : undefined}
              className={cn("flex h-11 flex-1 items-center justify-center rounded-md text-base", by === k ? "bg-background font-bold shadow-sm" : "text-muted-foreground")}
            >
              {BY_LABEL[k]}
            </Link>
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <EmptyState title="この期間の稼働はまだありません">
          確定した稼働があると、ここにスタッフ・会場・取引先ごとの獲得件数が出ます。過去の分は「データ取り込み」から入れられます。
        </EmptyState>
      ) : (
        <>
          {/* スマホ: 1行ずつ */}
          <ol className="divide-y border-y md:hidden">
            {groups.map((g, i) => (
              <li key={g.id}>
                <Link href={HREF[by](g.id)} className="flex min-h-16 items-start gap-3 px-4 py-2 hover:bg-accent">
                  <span className="w-6 pt-0.5 text-right text-sm text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-medium">{g.name}</span>
                      <span className="shrink-0 font-bold">{g.total}件</span>
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      1稼働あたり {g.avg ?? "−"}件 ・ 稼働 {g.worked}人日{by !== "staff" && ` ・ 現場 ${g.events}件`}
                      {pending(g) > 0 && <span className="text-status-waiting">（{basis === "confirmed" ? "未確定" : "未報告"} {pending(g)}）</span>}
                    </span>
                    {g.total > 0 && (
                      <span className="block text-sm text-muted-foreground">
                        {items
                          .filter((it) => g.byItem[it.id])
                          .map((it) => `${it.name} ${g.byItem[it.id]}`)
                          .join("、")}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ol>

          {/* PC: 表 */}
          <div className="hidden overflow-x-auto px-4 md:block">
            <table className="w-full border-collapse text-base">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th scope="col" className="w-10 py-2 pr-2 text-right font-medium">順位</th>
                  <th scope="col" className="py-2 pr-4 font-medium">{by === "staff" ? "スタッフ" : by === "venue" ? "会場" : "取引先"}</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">獲得件数</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">1稼働あたり</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">稼働</th>
                  {by !== "staff" && <th scope="col" className="py-2 pr-4 text-right font-medium">現場</th>}
                  {items.map((it) => (
                    <th key={it.id} scope="col" className="py-2 pr-4 text-right font-medium whitespace-nowrap">
                      {it.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((g, i) => (
                  <tr key={g.id} className="border-b hover:bg-accent">
                    <td className="py-2 pr-2 text-right text-sm text-muted-foreground">{i + 1}</td>
                    <td className="py-2 pr-4">
                      <Link href={HREF[by](g.id)} className="font-medium text-primary hover:underline">
                        {g.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-right font-bold">{g.total}</td>
                    <td className="py-2 pr-4 text-right">{g.avg ?? "−"}</td>
                    <td className="py-2 pr-4 text-right whitespace-nowrap">
                      {g.worked}人日
                      {pending(g) > 0 && <span className="block text-sm text-status-waiting">{basis === "confirmed" ? "未確定" : "未報告"} {pending(g)}</span>}
                    </td>
                    {by !== "staff" && <td className="py-2 pr-4 text-right">{g.events}</td>}
                    {items.map((it) => (
                      <td key={it.id} className="py-2 pr-4 text-right">
                        {g.byItem[it.id] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 text-sm text-muted-foreground">
            1稼働あたり = 獲得件数 ÷ 件数の分かる稼働（{basis === "confirmed" ? "確定済み" : "報告済み"}）。中止の現場は数えません。
          </p>
        </>
      )}
    </div>
  );
}
