import { ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { formatShortJa } from "@/lib/date";
import { callMypage, type MypageEvent } from "@/lib/mypage";
import { EventCard } from "../../event-card";
import { ReportForm } from "./report-form";

type Report = {
  event: MypageEvent;
  role: string;
  deadline: string;
  editable: boolean;
  confirmed: boolean;
  submitted_at: string | null;
  comment: string;
  items: { item_id: string; name: string; reported: number | null; confirmed: number | null }[];
  expenses: { transport?: { amount: number; memo: string; status: "pending" | "approved" | "rejected" }; other?: { amount: number; memo: string; status: "pending" | "approved" | "rejected" } };
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
    </div>
  );
}
