import { toCsv } from "@/lib/csv";

/** 全データの書き出しに入れない列・JSON の中の項目（マイページ・見るだけリンクの鍵など、漏れると入られてしまうもの） */
const SECRET = /token/i;

function scrub(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => !SECRET.test(k)).map(([k, x]) => [k, scrub(x)]));
  return v;
}

function cell(v: unknown): unknown {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

/** テーブルの行を CSV にする（見出しは列名。JSON は文字列にする。鍵は消す） */
export function tablesToCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return toCsv([]);
  const cols = Object.keys(rows[0]).filter((c) => !SECRET.test(c));
  return toCsv([cols, ...rows.map((r) => cols.map((c) => cell(scrub(r[c]))))]);
}
