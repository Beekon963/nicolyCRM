/** 金額の表示（例: 25000 → 「25,000円」） */
export function formatYen(n: number | null | undefined, empty = "−"): string {
  if (n == null) return empty;
  return `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("ja-JP")}円`;
}

/** 入力欄の文字（「25,000」「２５０００円」など）を整数（円）にする。空なら null、読めなければ NaN */
export function parseYen(text: string): number | null {
  const t = text.normalize("NFKC").replace(/[,円\s]/g, "");
  if (!t) return null;
  if (!/^-?\d+$/.test(t)) return Number.NaN;
  return Number(t);
}
