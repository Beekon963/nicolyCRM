/**
 * 案件の進み具合で LINE に貼る文（Phase 21。DB を使わない）。
 * - 本人へ: 面談の候補日時のお願い、面談の日時の共有
 * - 取引先へ: 候補日時のまとめ（会場・日付・名前・候補日時の順。いま手で打っている形に合わせる）
 * 金額・電話番号は入れない。
 */
import { type DateString, formatShortJa, formatTimeJst, toJstDateString } from "@/lib/date";

const dayOf = (d: DateString) => Number(d.slice(8, 10));

/** 「14・15日」のように日をまとめる（同じ月だけなら日だけ。月が違えば 10/31・11/1） */
export function joinDays(dates: DateString[]): string {
  const uniq = [...new Set(dates)].sort();
  if (!uniq.length) return "";
  const months = new Set(uniq.map((d) => d.slice(0, 7)));
  if (months.size === 1) return `${uniq.map(dayOf).join("・")}日`;
  return uniq.map((d) => `${Number(d.slice(5, 7))}/${dayOf(d)}`).join("・");
}

/** 本人へ: 面談の候補日時を3つもらう */
export function slotsRequestText(p: { staffName: string; clientName: string; venues: string[]; dates: DateString[] }): string {
  const where = [...new Set(p.venues)].filter(Boolean).join("・");
  const when = joinDays(p.dates);
  return [
    `${p.staffName}さん`,
    `${p.clientName}の案件${when ? `（${when}${where ? ` ${where}` : ""}）` : where ? `（${where}）` : ""}の件で、取引先との面談があります。`,
    "面談できる候補の日時を3つ、下の形で送ってください。",
    "",
    "例）",
    "10/26 20:00〜",
    "10/27 9:00〜12:00",
    "10/28 終日",
    "",
    "よろしくお願いします！",
  ].join("\n");
}

export type SummaryLine = {
  /** その人がこの案件で入る日（確定・打診中） */
  dates: DateString[];
  venue: string;
  /** その会場・日の必要人数（1なら省く） */
  count: number;
  staffName: string;
  /** 本人からの候補日時（改行区切り） */
  slots: string;
};

/** 取引先へ: 会場・日付ごとに「名前」「候補日時」を並べたまとめ */
export function slotsSummaryText(lines: SummaryLine[]): string {
  const blocks = lines.map((l) => {
    const head = `${joinDays(l.dates)}${l.venue ? ` ${l.venue}` : ""}${l.count > 1 ? `　${l.count}名` : ""}`.trim();
    return [head, l.staffName, l.slots.trim()].filter(Boolean).join("\n");
  });
  return [...blocks, "お願いします！"].join("\n\n");
}

/** 本人へ: 決まった面談の日時とリンク */
export function interviewShareText(p: { staffName: string; clientName: string; interviewAt: string; note: string }): string {
  const at = new Date(p.interviewAt);
  const when = `${formatShortJa(toJstDateString(at))} ${formatTimeJst(at)}〜`;
  return [`${p.staffName}さん`, `${p.clientName}の面談は ${when} です。`, p.note.trim(), "", "当日はよろしくお願いします！"].filter((l, i) => l !== "" || i === 3).join("\n");
}
