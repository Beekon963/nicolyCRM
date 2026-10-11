import { lineBot } from "@/lib/line/notify";
import { callMypage, type MypageEvent } from "@/lib/mypage";
import { EventCard } from "./event-card";
import { LineCard } from "./line-card";
import { OfferButtons } from "./offer-buttons";

export default async function MypageOffers({ params }: PageProps<"/m/[token]">) {
  const { token } = await params;
  const r = await callMypage<{ items: { assignment_id: string; role: string; event: MypageEvent }[] }>("mypage_offers", { p_token: token });
  if (!r.ok) return <p className="text-status-alert">{r.error}</p>;
  const items = r.data.items;
  // LINE 公式アカウントの準備ができているときだけ「LINE とつなぐ」を出す
  const [bot, line] = await Promise.all([lineBot(), callMypage<{ linked: boolean }>("mypage_line_status", { p_token: token })]);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[22px] leading-8 font-bold">参加できますか？</h1>
        <p className="text-sm text-muted-foreground">お願いしている現場です。「参加できる」か「できない」を押してください。</p>
      </div>
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-input bg-[#fcfcfd] p-6 text-center text-muted-foreground">いまお願いしている現場はありません。</p>
      ) : (
        items.map((o) => (
          <EventCard key={o.assignment_id} event={o.event} role={o.role} detail>
            <OfferButtons token={token} assignmentId={o.assignment_id} />
          </EventCard>
        ))
      )}
      {bot && line.ok && <LineCard token={token} linked={line.data.linked} botName={bot.displayName || bot.basicId} />}
    </div>
  );
}
