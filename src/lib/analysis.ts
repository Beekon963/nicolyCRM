/**
 * 実績の集計（要件 Phase 2「実績ランキング、会場別・取引先別の分析」、§4.1-5 ホームの実績トップ）。
 * 金額は扱わない（獲得件数と稼働の数だけ）。DB から取った行をここで数える。
 */
import { addDays, monthOf, monthRange } from "@/lib/date";

export type Basis = "confirmed" | "reported";
export type GroupBy = "staff" | "venue" | "client";

/** 確定したアサイン1件（中止の現場は除いて渡す） */
export type ResultRow = {
  eventId: string;
  date: string;
  staff: { id: string; name: string } | null;
  venue: { id: string; name: string } | null;
  client: { id: string; name: string } | null;
  submittedAt: string | null;
  confirmedAt: string | null;
  items: { item_id: string; reported_count: number | null; confirmed_count: number | null }[];
};

export type AnalysisGroup = {
  id: string;
  name: string;
  /** 稼働（延べ人数＝人日） */
  worked: number;
  /** 件数が分かっている稼働（確定ベースは確定済み、速報ベースは報告あり） */
  counted: number;
  /** 現場の数 */
  events: number;
  /** 獲得件数の合計 */
  total: number;
  /** 1稼働あたりの獲得件数（小数1桁。件数の分かる稼働がなければ null） */
  avg: number | null;
  byItem: Record<string, number>;
};

/** この稼働の件数が分かっているか */
export function isCounted(r: Pick<ResultRow, "submittedAt" | "confirmedAt">, basis: Basis) {
  return basis === "confirmed" ? r.confirmedAt != null : r.submittedAt != null || r.confirmedAt != null;
}

/** 1項目の件数。速報ベースで速報がない（管理者が直接確定した）ときは確定の件数を使う */
export function itemCount(i: ResultRow["items"][number], basis: Basis) {
  return (basis === "confirmed" ? i.confirmed_count : (i.reported_count ?? i.confirmed_count)) ?? 0;
}

export function analyze(rows: ResultRow[], by: GroupBy, basis: Basis): AnalysisGroup[] {
  const groups = new Map<string, AnalysisGroup & { eventIds: Set<string> }>();
  for (const r of rows) {
    const key = r[by];
    if (!key) continue;
    let g = groups.get(key.id);
    if (!g) {
      g = { id: key.id, name: key.name, worked: 0, counted: 0, events: 0, total: 0, avg: null, byItem: {}, eventIds: new Set() };
      groups.set(key.id, g);
    }
    g.worked += 1;
    g.eventIds.add(r.eventId);
    if (!isCounted(r, basis)) continue;
    g.counted += 1;
    for (const i of r.items) {
      const n = itemCount(i, basis);
      if (!n) continue;
      g.total += n;
      g.byItem[i.item_id] = (g.byItem[i.item_id] ?? 0) + n;
    }
  }
  return [...groups.values()]
    .map(({ eventIds, ...g }) => ({ ...g, events: eventIds.size, avg: g.counted ? Math.round((g.total / g.counted) * 10) / 10 : null }))
    .sort((a, b) => b.total - a.total || (b.avg ?? -1) - (a.avg ?? -1) || a.name.localeCompare(b.name, "ja"));
}

export type RangeKey = "month" | "prev" | "3m" | "12m";

export const RANGE_LABEL: Record<RangeKey, string> = {
  month: "今月",
  prev: "先月",
  "3m": "直近3か月",
  "12m": "直近12か月",
};

/** 期間（日本時間の暦日）。今日より先の現場は数えない */
export function rangeOf(key: RangeKey, today: string): { start: string; end: string } {
  const month = monthOf(today);
  const back = (n: number) => {
    let m = month;
    for (let i = 0; i < n; i++) m = monthOf(addDays(`${m}-01`, -1));
    return m;
  };
  switch (key) {
    case "prev":
      return monthRange(back(1));
    case "3m":
      return { start: `${back(2)}-01`, end: today };
    case "12m":
      return { start: `${back(11)}-01`, end: today };
    default:
      return { start: `${month}-01`, end: today };
  }
}
