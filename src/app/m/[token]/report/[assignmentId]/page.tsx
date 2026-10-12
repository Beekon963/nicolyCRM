import { ChevronDownIcon, ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { ReportConverter } from "@/components/app/report-converter";
import { ShareButtons } from "@/components/app/share-buttons";
import { formatShortJa, parse, weekdayJa } from "@/lib/date";
import { callMypage, type MypageEvent } from "@/lib/mypage";
import { type NameDict, renameItems } from "@/lib/report-convert";
import { renderReport } from "@/lib/report-format";
import { formatTimeRange } from "@/lib/templates";
import { EventCard } from "../../event-card";
import { ReportForm } from "./report-form";

type Report = {
  event: MypageEvent;
  role: string;
  staff_name?: string;
  client_name?: string;
  deadline: string;
  editable: boolean;
  confirmed: boolean;
  submitted_at: string | null;
  comment: string;
  items: { item_id: string; name: string; reported: number | null; confirmed: number | null }[];
  expenses: { transport?: { amount: number; memo: string; status: "pending" | "approved" | "rejected" }; other?: { amount: number; memo: string; status: "pending" | "approved" | "rejected" } };
  /** この現場の取引先で使う日報のフォーマット（DB が古いときは返らないことがある） */
  formats?: { id: string; name: string; header: string; event_block: string; person_block: string; footer: string }[];
  /** 言いかえ表（いつもの書き方 → 公認名称） */
  aliases?: { alias: string; name: string }[];
  /** 同じ現場の全員（本人を含む）の報告。名前・役割・件数・コメントだけ */
  coworkers?: { name: string; role: string; me: boolean; submitted: boolean; comment: string; counts: Record<string, number> }[];
};

/** 現場の全員分をまとめる書式か（{稼働者}{獲得した項目}{所感} を「はじめ・現場ごと・おわり」で使っている） */
const isSiteLevel = (f: { header: string; event_block: string; footer: string }) => /\{(稼働者|獲得した項目|所感)\}/.test(f.header + f.event_block + f.footer);

export default async function MypageReport({ params }: PageProps<"/m/[token]/report/[assignmentId]">) {
  const { token, assignmentId } = await params;
  const r = await callMypage<Report>("mypage_report_get", { p_token: token, p_assignment_id: assignmentId });
  if (!r.ok) return <p className="text-status-alert">{r.error}</p>;
  const d = r.data;
  return (
    <div className="flex flex-col gap-4">
      <Link href={`/m/${token}/report`} className="-ml-1 inline-flex h-11 items-center gap-1 self-start text-muted-foreground">
        <ChevronLeftIcon className="size-5" />
        報告の一覧へ
      </Link>
      <EventCard event={d.event} role={d.role} />
      {d.confirmed ? (
        <p className="rounded-lg bg-status-done-bg p-3 text-status-done">管理者が確定しました。修正が必要なときは管理者に連絡してください。</p>
      ) : !d.editable ? (
        <p className="rounded-lg bg-muted p-3">報告できる期間（{formatShortJa(d.deadline)}まで）を過ぎています。管理者に連絡してください。</p>
      ) : d.submitted_at ? (
        <p className="rounded-lg bg-status-done-bg p-3 text-status-done">送信済みです。{formatShortJa(d.deadline)}まで修正できます。</p>
      ) : null}
      <ReportForm token={token} assignmentId={assignmentId} items={d.items} comment={d.comment} expenses={d.expenses} editable={d.editable} />
      {d.submitted_at && (d.formats ?? []).length > 0 && <LineReports d={d} />}
      {(d.formats ?? []).length > 0 && <LineConvert d={d} />}
    </div>
  );
}

/**
 * 送った報告を、日報のフォーマットの文章にして LINE にコピーする。
 * - ふつうの書式は本人の1人分
 * - 現場の全員分をまとめる書式（NextWave など）は、同じ現場の全員の報告をまとめる（2人以上の現場は代表の1人が送る）
 * - 項目名は言いかえ表で取引先の名前（公認名称）に直す
 */
function LineReports({ d }: { d: Report }) {
  const { m, d: day } = parse(d.event.date);
  const dict: NameDict = { items: d.items.map((i) => i.name), aliases: d.aliases ?? [] };
  const mine = { name: d.staff_name ?? "", role: d.role, items: renameItems(d.items.map((i) => ({ name: i.name, count: i.confirmed ?? i.reported })), dict), comment: d.comment };
  const coworkers = d.coworkers ?? [];
  const everyone = coworkers.length
    ? coworkers.map((c) => ({
        name: c.name,
        role: c.role,
        items: renameItems(
          d.items.map((i) => ({ name: i.name, count: c.counts[i.name] ?? null })),
          dict,
        ),
        comment: c.comment,
        unreported: !c.submitted && Object.keys(c.counts).length === 0,
      }))
    : [mine];
  const waiting = coworkers.filter((c) => !c.me && !c.submitted).map((c) => c.name);
  const dayOf = (people: (typeof everyone)[number][]) => ({
    date: `${m}/${day}`,
    weekday: weekdayJa(d.event.date),
    clientName: d.client_name ?? "",
    events: [{ venueName: d.event.venue.name, time: formatTimeRange(d.event.start_time, d.event.end_time), people }],
  });
  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-card">
      <h2 className="font-bold">LINE用にコピー（日報）</h2>
      {(d.formats ?? []).map((f) => {
        const site = isSiteLevel(f) && everyone.length > 1;
        const text = renderReport({ header: f.header, eventBlock: f.event_block, personBlock: f.person_block, footer: f.footer }, dayOf(site ? everyone : [mine]));
        return (
          <div key={f.id} className="flex flex-col gap-2">
            <p className="text-sm font-bold text-muted-foreground">{f.name}</p>
            {site && (
              <p className="text-sm text-[#344054]">
                この現場は{everyone.length}人です。全員分をまとめました。<b className="font-semibold">代表の1人が送ってください。</b>
                {waiting.length > 0 && (
                  <span className="mt-1 block text-status-waiting">まだ報告していない人: {waiting.join("、")}（報告がそろってから送ってください）</span>
                )}
              </p>
            )}
            <pre className="rounded-xl bg-[#8cabd8]/20 p-3 font-sans text-base break-words whitespace-pre-wrap">{text}</pre>
            <ShareButtons text={text} size="sm" />
          </div>
        );
      })}
    </section>
  );
}

/** LINE にいつもの書き方で書いた報告を、取引先の公認名称・書式に直す（たたんでおく） */
function LineConvert({ d }: { d: Report }) {
  const { m, d: day } = parse(d.event.date);
  const workers = (d.coworkers ?? []).map((c) => c.name);
  return (
    <details className="group rounded-2xl border bg-card shadow-card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 font-bold">
        LINE に書いた報告から変換
        <ChevronDownIcon className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t p-4">
        <p className="mb-3 text-sm text-muted-foreground">いつもの書き方（キヘン・光・GOLD など）で書いた報告を貼ると、{d.client_name ?? "取引先"}の名前と形に直します。</p>
        <ReportConverter
          dict={{ items: d.items.map((i) => i.name), aliases: d.aliases ?? [] }}
          formats={(d.formats ?? []).map((f) => ({ id: f.id, name: f.name, blocks: { header: f.header, eventBlock: f.event_block, personBlock: f.person_block, footer: f.footer } }))}
          defaults={{ date: `${m}/${day}`, weekday: weekdayJa(d.event.date), venue: d.event.venue.name, workers: workers.length ? workers : [d.staff_name ?? ""], clientName: d.client_name ?? "" }}
        />
      </div>
    </details>
  );
}
