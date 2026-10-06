import { ExternalLinkIcon } from "lucide-react";
import { formatShortJa } from "@/lib/date";
import type { MypageEvent } from "@/lib/mypage";
import { formatTime, formatTimeRange } from "@/lib/templates";
import { cn } from "@/lib/utils";

export function mapLink(v: { address: string; name: string }) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.address || v.name)}`;
}

/** 現場の情報（マイページ用。金額は出さない） */
export function EventCard({
  event,
  role,
  detail,
  children,
  className,
}: {
  event: MypageEvent;
  role?: string;
  detail?: boolean;
  children?: React.ReactNode;
  className?: string;
}) {
  const v = event.venue;
  return (
    <section className={cn("flex flex-col gap-2 rounded-xl border p-4", event.cancelled && "opacity-60", className)}>
      <p className="text-lg font-bold">
        {formatShortJa(event.date)} {formatTimeRange(event.start_time, event.end_time)}
      </p>
      <p className="text-lg">{v.name}</p>
      {role && <p className="text-muted-foreground">役割: {role}</p>}
      {event.cancelled && <p className="font-bold text-status-alert">この現場は中止になりました</p>}
      {detail && (
        <dl className="grid grid-cols-[5rem_1fr] gap-x-2 gap-y-1 text-base">
          <dt className="text-muted-foreground">集合</dt>
          <dd className="font-bold">{[formatTime(event.meeting_time), event.meeting_place].filter(Boolean).join(" ") || "−"}</dd>
          {v.address && (
            <>
              <dt className="text-muted-foreground">住所</dt>
              <dd>
                <a href={mapLink(v)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary underline">
                  {v.address}
                  <ExternalLinkIcon className="size-4" />
                </a>
              </dd>
            </>
          )}
          {v.nearest_station && (
            <>
              <dt className="text-muted-foreground">最寄り駅</dt>
              <dd>{v.nearest_station}</dd>
            </>
          )}
          {event.belongings && (
            <>
              <dt className="text-muted-foreground">服装・持ち物</dt>
              <dd className="whitespace-pre-wrap">{event.belongings}</dd>
            </>
          )}
          {event.notes && (
            <>
              <dt className="text-muted-foreground">注意事項</dt>
              <dd className="whitespace-pre-wrap">{event.notes}</dd>
            </>
          )}
          {v.access_notes && (
            <>
              <dt className="text-muted-foreground">入館方法</dt>
              <dd className="whitespace-pre-wrap">{v.access_notes}</dd>
            </>
          )}
          {v.green_room && (
            <>
              <dt className="text-muted-foreground">控室</dt>
              <dd>{v.green_room}</dd>
            </>
          )}
        </dl>
      )}
      {children}
    </section>
  );
}
