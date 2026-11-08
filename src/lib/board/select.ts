/**
 * 複数日の選択（Phase 22-6）: 週・月の表で、1人の行の何日かを長押し→ドラッグ（またはタップ）で選び、
 * まとめて ○△× を入れる・同じ現場に入れる。画面に依存しない形にしてテストする
 */
import type { DateString } from "@/lib/date";

export type DaySelection = { staffId: string; dates: DateString[] };

/** anchor から focus までの範囲（表に並ぶ日付 dates の順で。focus が表にないときは anchor だけ） */
export function rangeDates(
  dates: DateString[],
  anchor: DateString,
  focus: DateString,
): DateString[] {
  const a = dates.indexOf(anchor);
  const b = dates.indexOf(focus);
  if (a < 0) return [];
  if (b < 0) return [anchor];
  const [i, j] = a <= b ? [a, b] : [b, a];
  return dates.slice(i, j + 1);
}

/** 日を足す・外す（並びは表の順） */
export function toggleDate(
  sel: DaySelection,
  date: DateString,
  dates: DateString[],
): DaySelection {
  const set = new Set(sel.dates);
  if (set.has(date)) set.delete(date);
  else set.add(date);
  return { ...sel, dates: dates.filter((d) => set.has(d)) };
}

/** 選んだ日に、もともと選んでいた日と anchor〜focus の範囲を合わせる（ドラッグ中） */
export function extendSelection(
  base: DaySelection,
  dates: DateString[],
  anchor: DateString,
  focus: DateString,
): DaySelection {
  const range = new Set(rangeDates(dates, anchor, focus));
  const had = new Set(base.dates);
  return { ...base, dates: dates.filter((d) => had.has(d) || range.has(d)) };
}

/** まとめて入れる先の候補を作るのに要る現場の情報（data.events の形） */
export type EventLike = {
  id: string;
  date: string;
  venueId: string;
  venueName: string;
  venueColor: string;
  venueShort: string;
  carrier: string;
  clientName: string;
  cancelled: boolean;
  shortage: number;
};

/** 選んだ日に現場のある会場（まとめて入れる先）。日ごとの現場 id と、選んだ日のうちその会場の現場がない日 */
export type BulkTarget = {
  venueId: string;
  venueName: string;
  venueColor: string;
  venueShort: string;
  carrier: string;
  clientName: string;
  /** 日 → 現場 id */
  events: Record<DateString, string>;
  /** 選んだ日のうち、この会場の現場がない日 */
  missing: DateString[];
  /** 選んだ日の欠員の合計 */
  shortage: number;
};

export function bulkTargets(
  events: Record<string, EventLike>,
  dates: DateString[],
): BulkTarget[] {
  const want = new Set(dates);
  const m = new Map<string, BulkTarget>();
  for (const e of Object.values(events)) {
    if (e.cancelled || !want.has(e.date)) continue;
    const t = m.get(e.venueId) ?? {
      venueId: e.venueId,
      venueName: e.venueName,
      venueColor: e.venueColor,
      venueShort: e.venueShort,
      carrier: e.carrier,
      clientName: e.clientName,
      events: {},
      missing: [],
      shortage: 0,
    };
    // 同じ会場に同じ日2件（まれ）は、欠員のある方を優先
    const cur = t.events[e.date];
    if (!cur || (events[cur].shortage === 0 && e.shortage > 0))
      t.events[e.date] = e.id;
    m.set(e.venueId, t);
  }
  return [...m.values()]
    .map((t) => ({
      ...t,
      missing: dates.filter((d) => !t.events[d]),
      shortage: Object.values(t.events).reduce(
        (n, id) => n + events[id].shortage,
        0,
      ),
    }))
    .sort(
      (a, b) =>
        Object.keys(b.events).length - Object.keys(a.events).length ||
        b.shortage - a.shortage ||
        a.venueName.localeCompare(b.venueName, "ja"),
    );
}

/** 現場に入れるときの役割: 空きがあってその人ができる役割 → 空きのある役割 → できる役割 → 最初の役割 */
export function pickRole(
  byRole: Record<string, { required: number; shortage: number }>,
  canDo: string[],
  fallback?: string,
): string | undefined {
  const entries = Object.entries(byRole).filter(([, r]) => r.required > 0);
  return (
    entries.find(([id, r]) => r.shortage > 0 && canDo.includes(id))?.[0] ??
    entries.find(([, r]) => r.shortage > 0)?.[0] ??
    entries.find(([id]) => canDo.includes(id))?.[0] ??
    entries[0]?.[0] ??
    fallback
  );
}
