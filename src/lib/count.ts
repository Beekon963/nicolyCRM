/**
 * 獲得件数（Phase 11）。2人以上で取った件数は人数で割るので、小数第2位まで持つ（0.5件・0.33件）。
 * 足し算の誤差（0.1 + 0.2 = 0.30000000000000004）が画面に出ないよう、合計はここでそろえる。
 * スタッフがふだん入れる件数は整数のまま
 */

/** 小数第2位にそろえる */
export function roundCount(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 件数の合計（空は0） */
export function sumCounts(values: (number | null | undefined)[]): number {
  return Math.round(values.reduce<number>((a, n) => a + Math.round((n ?? 0) * 100), 0)) / 100;
}

/** 0.01件単位の整数（お金の計算に使う） */
export function countHundredths(n: number): number {
  return Math.round(n * 100);
}

/**
 * 件数を人数で割る（合計が元の件数になるよう、割り切れない0.01件は前の人から1つずつ足す）。
 * 例: 1件を3人 → 0.34, 0.33, 0.33 / 1件を2人 → 0.5, 0.5
 */
export function splitCount(count: number, people: number): number[] {
  if (people <= 0) return [];
  const h = countHundredths(count);
  const base = Math.floor(h / people);
  const rest = h - base * people;
  return Array.from({ length: people }, (_, i) => (base + (i < rest ? 1 : 0)) / 100);
}

/** 画面に出す形（2 → "2"、0.5 → "0.5"、0.333 → "0.33"） */
export function formatCount(n: number): string {
  return String(roundCount(n));
}

/** 件数として正しいか（0以上で、小数第2位まで） */
export function isCount(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
}
