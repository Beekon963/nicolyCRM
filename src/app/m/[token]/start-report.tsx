import { MapPinCheckIcon } from "lucide-react";
import { ShareButtons } from "@/components/app/share-buttons";
import { parse, weekdayJa } from "@/lib/date";
import type { MypageEvent } from "@/lib/mypage";
import { renderStart } from "@/lib/report-format";
import { formatTimeRange } from "@/lib/templates";

export type StartReportData = {
  event: MypageEvent;
  staff_name?: string;
  client_name?: string;
  formats?: { id: string; name: string; start_block?: string }[];
  coworkers?: { name: string }[];
};

/**
 * 稼働開始の報告（現場に着いたら「稼働します」を LINE に送る）。稼働日の当日だけ出す。
 * 取引先の書式に「稼働開始の報告」があるときだけ（NextWave など）。2人以上の現場は全員の名前が入る（代表の1人が送る）
 */
export function StartReport({ d }: { d: StartReportData }) {
  const formats = (d.formats ?? []).filter((f) => f.start_block?.trim());
  if (!formats.length) return null;
  const { m, d: day } = parse(d.event.date);
  const names = (d.coworkers ?? []).map((c) => c.name);
  const people = (names.length ? names : [d.staff_name ?? ""]).map((name) => ({ name, role: "", items: [], comment: "" }));
  const reportDay = {
    date: `${m}/${day}`,
    weekday: weekdayJa(d.event.date),
    clientName: d.client_name ?? "",
    events: [{ venueName: d.event.venue.name, time: formatTimeRange(d.event.start_time, d.event.end_time), people }],
  };
  return (
    <section id="start" aria-labelledby="start-title" className="flex scroll-mt-20 flex-col gap-3 rounded-2xl border border-brand-100 bg-brand-50 p-4">
      <h2 id="start-title" className="flex items-center gap-2 font-bold">
        <MapPinCheckIcon className="size-5 text-primary" aria-hidden />
        現場に着いたら（稼働開始の報告）
      </h2>
      {people.length > 1 && <p className="text-sm text-[#344054]">この現場は{people.length}人です。代表の1人が送ってください。</p>}
      {formats.map((f) => {
        const text = renderStart(f.start_block ?? "", reportDay);
        return (
          <div key={f.id} className="flex flex-col gap-2">
            {formats.length > 1 && <p className="text-sm font-bold text-muted-foreground">{f.name}</p>}
            <pre className="rounded-xl bg-background p-3 font-sans text-base break-words whitespace-pre-wrap">{text}</pre>
            <ShareButtons text={text} size="sm" />
          </div>
        );
      })}
    </section>
  );
}
