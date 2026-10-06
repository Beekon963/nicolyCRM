import { callMypage, type MypageEvent } from "@/lib/mypage";
import { EventCard } from "./event-card";
import { OfferButtons } from "./offer-buttons";

export default async function MypageOffers({ params }: PageProps<"/m/[token]">) {
  const { token } = await params;
  const r = await callMypage<{ items: { assignment_id: string; role: string; event: MypageEvent }[] }>("mypage_offers", { p_token: token });
  if (!r.ok) return <p className="text-status-alert">{r.error}</p>;
  const items = r.data.items;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">お願い（参加できるか教えてください）</h1>
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground">いまお願いしている現場はありません。</p>
      ) : (
        items.map((o) => (
          <EventCard key={o.assignment_id} event={o.event} role={o.role} detail>
            <OfferButtons token={token} assignmentId={o.assignment_id} />
          </EventCard>
        ))
      )}
    </div>
  );
}
