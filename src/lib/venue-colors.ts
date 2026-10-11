import type { CSSProperties } from "react";

/**
 * 会場の色（Phase 6・7）。稼働表で、上の段の現場と下の段のスタッフのマスを同じ色にする。
 * - マスは「薄い地（tint）＋ 左の線（bar）＋ 濃い文字（fg）」。濃すぎず、どの会場かは左の線と地の色で分かる
 * - 線（bar）の7色は、彩度を抑えた落ち着いた色。どの2色も（状態の赤・黄・緑とも）ふつうの見え方ではっきり違う組み合わせ（OKLab で 15 以上）
 * - 赤・黄・緑は「欠員・打診中・埋まった」専用なので使わない（色だけで見分けにくい人のため、マスには必ず会場名も出す）
 * - 文字は地の上で 7:1 以上
 * - DB の venues.color はキー（blue など）だけを持つ。キーを足すときはマイグレーションの check も直す
 */
export const VENUE_COLORS = {
  blue: { label: "青", bar: "#246cc2", tint: "#d9e6f8", fg: "#1e3a8a" },
  navy: { label: "紺", bar: "#253d65", tint: "#dde3ec", fg: "#0f172a" },
  sky: { label: "水色", bar: "#3ea6ce", tint: "#d6eef8", fg: "#0c4a6e" },
  purple: { label: "紫", bar: "#7a34a9", tint: "#ece0f7", fg: "#581c87" },
  lavender: { label: "藤", bar: "#b9a1fa", tint: "#ebe5fe", fg: "#4c1d95" },
  pink: { label: "桃", bar: "#dc719d", tint: "#f9e0eb", fg: "#831843" },
  brown: { label: "茶", bar: "#774b22", tint: "#efe4d9", fg: "#451a03" },
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

/** マスに付ける CSS 変数（bg-(--v-tint)・text-(--v-fg) などで使う） */
export function venueStyle(key: string | null | undefined): CSSProperties {
  const c = venueColor(key);
  return { "--v-bar": c.bar, "--v-tint": c.tint, "--v-fg": c.fg } as CSSProperties;
}
