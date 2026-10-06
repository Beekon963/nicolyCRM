import { Badge } from "@/components/ui/badge";
import { formatShortJa } from "@/lib/date";
import { callMypage } from "@/lib/mypage";

type Row = { date: string; venue: string; role: string; status: string; reported: number | null; confirmed: number | null };

export default async function MypageHistory({ params }: PageProps<"/m/[token]/history">) {
  const { token } = await params;
  const r = await callMypage<{ items: Row[] }>("mypage_history", { p_token: token });
  if (!r.ok) return <p className="text-status-alert">{r.error}</p>;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">過去の稼働（直近6か月）</h1>
      {r.data.items.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">まだ稼働はありません。</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {r.data.items.map((h, i) => (
            <li key={i} className="flex items-center gap-3 p-3">
              <span className="w-16 shrink-0 font-bold">{formatShortJa(h.date)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{h.venue}</span>
                <span className="text-sm text-muted-foreground">{h.role}</span>
              </span>
              {h.status === "no_show" ? (
                <Badge tone="muted">不稼働</Badge>
              ) : (
                <span className="text-right text-sm">
                  <span className="block">確定 {h.confirmed ?? "−"}件</span>
                  <span className="block text-muted-foreground">速報 {h.reported ?? "−"}件</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
