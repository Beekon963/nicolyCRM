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

/** 単価の表示（稼働表のマス用。例: [22000] → 「22,000」、[20000, 25000] → 「20,000〜25,000」。なければ空） */
export function rateRangeText(units: number[]): string {
  const u = [...new Set(units.filter((x) => x > 0))].sort((a, b) => a - b);
  if (!u.length) return "";
  const f = (n: number) => n.toLocaleString("ja-JP");
  return u.length === 1 ? f(u[0]) : `${f(u[0])}〜${f(u.at(-1)!)}`;
}
