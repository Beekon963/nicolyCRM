import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { ShareButtons } from "@/components/app/share-buttons";
import { formatShortJa, parse, weekdayJa } from "@/lib/date";
import { callMypage, type MypageEvent } from "@/lib/mypage";
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
};

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
    </div>
  );
}

/** 送った報告を、日報のフォーマットの文章にして LINE にコピーする（本人の1人分） */
function LineReports({ d }: { d: Report }) {
  const { m, d: day } = parse(d.event.date);
  const reportDay = {
    date: `${m}/${day}`,
    weekday: weekdayJa(d.event.date),
    clientName: d.client_name ?? "",
    events: [
      {
        venueName: d.event.venue.name,
        time: formatTimeRange(d.event.start_time, d.event.end_time),
        people: [{ name: d.staff_name ?? "", role: d.role, items: d.items.map((i) => ({ name: i.name, count: i.confirmed ?? i.reported })), comment: d.comment }],
      },
    ],
  };
  return (
    <section className="flex flex-col gap-3 rounded-lg border p-3">
      <h2 className="font-bold">LINE用にコピー（日報）</h2>
      {(d.formats ?? []).map((f) => {
        const text = renderReport({ header: f.header, eventBlock: f.event_block, personBlock: f.person_block, footer: f.footer }, reportDay);
        return (
          <div key={f.id} className="flex flex-col gap-2">
            <p className="text-sm font-bold text-muted-foreground">{f.name}</p>
            <pre className="rounded-md bg-[#8cabd8]/20 p-3 font-sans text-base break-words whitespace-pre-wrap">{text}</pre>
            <ShareButtons text={text} size="sm" />
          </div>
        );
      })}
    </section>
  );
}
