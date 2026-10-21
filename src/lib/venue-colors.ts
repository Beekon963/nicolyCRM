import type { CSSProperties } from "react";

/**
 * 会場の色（Phase 6・7・17）。稼働表で、上の段の現場と下の段のスタッフのマスを同じ色にする。
 * - 稼働表のマスは「しっかり塗る」（Phase 17）: 地が solid、文字が on（白か濃い紺。地の上で 4.5:1 以上）。
 *   遠目でも「埋まった所（会場の色）・足りない所（赤）・何もない所（白）」が分かるようにする
 * - ほかの画面（ホーム・現場一覧・カレンダー・会場）は「薄い地（tint）＋ 左の線（bar）＋ 濃い文字（fg）」のまま
 * - 7色は、どの2色も（状態の赤・黄・緑とも）ふつうの見え方ではっきり違う組み合わせ（OKLab で 15 以上。venue-colors.test.ts で確かめる）
 * - 赤・黄・緑は「欠員・打診中・埋まった」専用なので使わない（色だけで見分けにくい人のため、マスには必ず会場名も出す）
 * - DB の venues.color はキー（blue など）だけを持つ。キーを足すときはマイグレーションの check も直す
 */
const DARK = "#0f172a";
export const VENUE_COLORS = {
  blue: { label: "青", bar: "#246cc2", tint: "#d9e6f8", fg: "#1e3a8a", solid: "#246cc2", on: "#ffffff" },
  navy: { label: "紺", bar: "#253d65", tint: "#dde3ec", fg: "#0f172a", solid: "#253d65", on: "#ffffff" },
  sky: { label: "水色", bar: "#3ea6ce", tint: "#d6eef8", fg: "#0c4a6e", solid: "#3ea6ce", on: DARK },
  purple: { label: "紫", bar: "#7a34a9", tint: "#ece0f7", fg: "#581c87", solid: "#7a34a9", on: "#ffffff" },
  lavender: { label: "藤", bar: "#b9a1fa", tint: "#ebe5fe", fg: "#4c1d95", solid: "#b9a1fa", on: DARK },
  pink: { label: "桃", bar: "#dc719d", tint: "#f9e0eb", fg: "#831843", solid: "#dc719d", on: DARK },
  brown: { label: "茶", bar: "#774b22", tint: "#efe4d9", fg: "#451a03", solid: "#774b22", on: "#ffffff" },
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

/** マスに付ける CSS 変数（bg-(--v-tint)・text-(--v-fg)・bg-(--v-solid)・text-(--v-on) などで使う） */
export function venueStyle(key: string | null | undefined): CSSProperties {
  const c = venueColor(key);
  return { "--v-bar": c.bar, "--v-tint": c.tint, "--v-fg": c.fg, "--v-solid": c.solid, "--v-on": c.on } as CSSProperties;
}
