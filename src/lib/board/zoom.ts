/**
 * 稼働表の拡大・縮小（スプレッドシートの「ズーム」と同じ考え方）。
 * 表の中だけを拡大・縮小し、画面のほかの部分の大きさは変えない。
 */

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 2;

/** ＋ / − ボタンで止まる倍率（ブラウザやスプレッドシートのズームに近い刻み） */
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
}

/** ＋ / − を押したときの次の倍率。指で変えた半端な倍率からでも、次の刻みに進む */
export function stepZoom(z: number, dir: 1 | -1): number {
  const cur = clampZoom(z);
  if (dir > 0) return ZOOM_STEPS.find((s) => s > cur + 0.001) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((s) => s < cur - 0.001) ?? ZOOM_MIN;
}

/** 画面に出す倍率（例: 0.67 → 「67%」） */
export function zoomLabel(z: number): string {
  return `${Math.round(clampZoom(z) * 100)}%`;
}

/**
 * 拡大・縮小しても、指（またはマウス）の下にあったマスが同じ場所に残るようにするスクロール位置。
 * scroll: 今のスクロール位置、focal: 枠の左上から指までの距離（どちらも画面上の px）
 */
export function keepFocus(scroll: number, focal: number, from: number, to: number): number {
  return Math.max(0, ((scroll + focal) / from) * to - focal);
}
