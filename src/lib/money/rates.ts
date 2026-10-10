/**
 * 単価の選び方（要件 §4.9・Phase 0 決定4）。
 * 現場ごとの上書き → 取引先×会場の標準 → 取引先の標準 の順に、最初に見つかったものを使う。
 * 型は 人日（役割ごと）/ 現場固定 / 成果（獲得項目ごと）。
 */

export type RateKind = "per_person_day" | "per_event" | "per_item";
export type Rate = { kind: RateKind; roleId: string | null; itemId: string | null; amount: number };
export type RateLayer = "event" | "clientVenue" | "client";
export type RateTable = { event: Rate[]; clientVenue: Rate[]; client: Rate[] };

export const RATE_KIND_LABEL: Record<RateKind, string> = { per_person_day: "人日", per_event: "現場固定", per_item: "成果" };
export const RATE_LAYER_LABEL: Record<RateLayer, string> = { event: "この現場", clientVenue: "取引先×会場", client: "取引先" };

const LAYERS: RateLayer[] = ["event", "clientVenue", "client"];

function matches(r: Rate, kind: RateKind, key: string | null) {
  if (r.kind !== kind) return false;
  if (kind === "per_person_day") return r.roleId === key;
  if (kind === "per_item") return r.itemId === key;
  return true;
}

/** 使う単価とその出どころ。どこにもなければ null */
export function findRate(table: RateTable, kind: RateKind, key: string | null = null): { amount: number; layer: RateLayer } | null {
  for (const layer of LAYERS) {
    const r = table[layer].find((x) => matches(x, kind, key));
    if (r) return { amount: r.amount, layer };
  }
  return null;
}

/** インセンティブ単価: 現場ごとの上書き → 全体の標準 */
export function findIncentive(eventRates: Map<string, number> | undefined, globalRates: Map<string, number>, itemId: string): number | null {
  return eventRates?.get(itemId) ?? globalRates.get(itemId) ?? null;
}
