import type { CSSProperties } from "react";

/**
 * 会場の色（Phase 6）。稼働表で、上の段の現場と下の段のスタッフのマスを同じ色にする。
 * - 赤・黄・緑は「欠員・打診中・埋まった」専用なので使わない（色だけで見分けにくい人のため、マスには必ず会場名も出す）
 * - どの2色も、ふつうの見え方ではっきり違う組み合わせにしてある（色の差は OKLab で 15 以上）
 * - DB の venues.color はキー（blue など）だけを持つ。キーを足すときはマイグレーションの check も直す
 */
export const VENUE_COLORS = {
  blue: { label: "青", bg: "#2563eb", fg: "#ffffff", edge: "#1e3a8a" },
  navy: { label: "紺", bg: "#1e293b", fg: "#ffffff", edge: "#020617" },
  sky: { label: "水色", bg: "#38bdf8", fg: "#082f49", edge: "#0369a1" },
  purple: { label: "紫", bg: "#9333ea", fg: "#ffffff", edge: "#581c87" },
  lavender: { label: "藤", bg: "#d8b4fe", fg: "#3b0764", edge: "#9333ea" },
  pink: { label: "桃", bg: "#f472b6", fg: "#500724", edge: "#be185d" },
  brown: { label: "茶", bg: "#78350f", fg: "#ffffff", edge: "#451a03" },
} as const;

export type VenueColor = keyof typeof VENUE_COLORS;
export const VENUE_COLOR_KEYS = Object.keys(VENUE_COLORS) as VenueColor[];

export function isVenueColor(v: unknown): v is VenueColor {
  return typeof v === "string" && v in VENUE_COLORS;
}

/** 知らない値（古いデータなど）は青にする */
export function venueColor(key: string | null | undefined) {
  return VENUE_COLORS[isVenueColor(key) ? key : "blue"];
}

/** マスに付ける CSS 変数（bg-[var(--v-bg)] などで使う） */
export function venueStyle(key: string | null | undefined): CSSProperties {
  const c = venueColor(key);
  return { "--v-bg": c.bg, "--v-fg": c.fg, "--v-edge": c.edge } as CSSProperties;
}
