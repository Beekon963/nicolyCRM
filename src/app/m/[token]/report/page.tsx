import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatShortJa } from "@/lib/date";
import { callMypage, type MypageEvent } from "@/lib/mypage";

type Item = { assignment_id: string; role: string; submitted_at: string | null; confirmed: boolean; deadline: string; event: MypageEvent };

export default async function MypageReports({ params }: PageProps<"/m/[token]/report">) {
  const { token } = await params;
  const r = await callMypage<{ window_days: number; items: Item[] }>("mypage_reports", { p_token: token });
  if (!r.ok) return <p className="text-status-alert">{r.error}</p>;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">実績報告</h1>
      <p className="text-muted-foreground">稼働日から{r.data.window_days}日後まで報告・修正できます。</p>
      {r.data.items.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">いま報告できる稼働はありません。</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {r.data.items.map((i) => (
            <li key={i.assignment_id}>
              <Link href={`/m/${token}/report/${i.assignment_id}`} className="flex min-h-20 items-center gap-3 rounded-xl border p-4 active:bg-accent">
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-bold">{formatShortJa(i.event.date)}</span>
                  <span className="block truncate">{i.event.venue.name}</span>
                  <span className="mt-1 flex gap-1">
                    {i.confirmed ? (
                      <Badge tone="done">確定済み</Badge>
                    ) : i.submitted_at ? (
                      <Badge tone="done">送信済み（{formatShortJa(i.deadline)}まで修正可）</Badge>
                    ) : (
                      <Badge tone="alert">未報告</Badge>
                    )}
                  </span>
                </span>
                <ChevronRightIcon className="size-6 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
