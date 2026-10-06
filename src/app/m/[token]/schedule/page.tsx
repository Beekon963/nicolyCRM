import { Badge } from "@/components/ui/badge";
import { callMypage, type MypageEvent } from "@/lib/mypage";
import { EventCard } from "../event-card";

export default async function MypageSchedule({ params }: PageProps<"/m/[token]/schedule">) {
  const { token } = await params;
  const r = await callMypage<{ items: { assignment_id: string; role: string; status: string; event: MypageEvent }[] }>("mypage_schedule", {
    p_token: token,
  });
  if (!r.ok) return <p className="text-status-alert">{r.error}</p>;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">予定</h1>
      {r.data.items.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">確定した予定はまだありません。</p>
      ) : (
        r.data.items.map((s) => (
          <EventCard key={s.assignment_id} event={s.event} role={s.role} detail>
            {s.status === "waitlisted" && <Badge tone="waiting">補欠（空きが出たら連絡します）</Badge>}
          </EventCard>
        ))
      )}
    </div>
  );
}
