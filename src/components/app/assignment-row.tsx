import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatShortJa } from "@/lib/date";
import { ASSIGNMENT_STATUS } from "@/lib/labels";
import { formatTimeRange } from "@/lib/templates";

export type AssignmentSummary = {
  id: string;
  status: keyof typeof ASSIGNMENT_STATUS;
  role_id: string;
  event: { id: string; date: string; start_time: string | null; end_time: string | null; cancelled_at: string | null; venue: { name: string } | null; client: { name: string } | null };
  reported_total: number | null;
  confirmed_total: number | null;
};

/** スタッフ詳細・会場詳細などで使う「稼働の1行」 */
export function AssignmentRow({ a, roleName, showResults }: { a: AssignmentSummary; roleName?: string; showResults?: boolean }) {
  const st = ASSIGNMENT_STATUS[a.status];
  return (
    <li>
      <Link href={`/events/${a.event.id}`} className="flex items-center gap-3 py-2 hover:bg-accent">
        <span className="w-20 shrink-0 text-sm font-medium">{formatShortJa(a.event.date)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{a.event.venue?.name}</span>
          <span className="block truncate text-sm text-muted-foreground">
            {[roleName, formatTimeRange(a.event.start_time, a.event.end_time), a.event.client?.name].filter(Boolean).join(" / ")}
          </span>
        </span>
        {showResults && a.status === "confirmed" ? (
          <span className="text-right text-sm">
            <span className="block">確定 {a.confirmed_total ?? "−"}件</span>
            <span className="block text-muted-foreground">速報 {a.reported_total ?? "未報告"}{a.reported_total != null && "件"}</span>
          </span>
        ) : (
          <Badge tone={a.event.cancelled_at ? "muted" : st.tone}>{a.event.cancelled_at ? "中止" : st.label}</Badge>
        )}
      </Link>
    </li>
  );
}
