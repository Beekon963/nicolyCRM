/**
 * 送る文面を組み立てる（テンプレート × 現場 × スタッフ）。画面・サーバーのどちらからも使う。
 */
import { formatShortJa, weekdayJa } from "@/lib/date";
import { formatTime, formatTimeRange, renderTemplate, type TemplateValues } from "@/lib/templates";

export type MessageEvent = {
  date: string;
  start_time: string | null;
  end_time: string | null;
  meeting_time: string | null;
  meeting_place?: string | null;
  belongings?: string | null;
  venue: { name: string; address?: string | null } | null;
};

export function mypageUrl(siteUrl: string, token: string) {
  return `${siteUrl}/m/${token}`;
}

export function eventValues(ev: MessageEvent): TemplateValues {
  const [, m, d] = ev.date.split("-").map(Number);
  return {
    日付: `${m}/${d}`,
    曜日: weekdayJa(ev.date),
    時間: formatTimeRange(ev.start_time, ev.end_time),
    集合時刻: formatTime(ev.meeting_time),
    集合場所: ev.meeting_place ?? "",
    会場名: ev.venue?.name ?? "",
    住所: ev.venue?.address ?? "",
    持ち物: ev.belongings ?? "",
  };
}

export function buildMessage(
  template: string,
  ev: MessageEvent,
  staff: { name: string; mypage_token: string },
  opts: { siteUrl: string; roleName?: string },
): string {
  return renderTemplate(template, {
    ...eventValues(ev),
    名前: staff.name.split(/[\s　]/)[0],
    役割: opts.roleName ?? "",
    マイページURL: mypageUrl(opts.siteUrl, staff.mypage_token),
  });
}

export { formatShortJa };
