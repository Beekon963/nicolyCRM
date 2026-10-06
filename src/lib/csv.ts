/**
 * CSV の読み書き（要件 §4.9「Excel で文字化けしない UTF-8 BOM 付き」、§4.13 取り込み）。
 * Excel で保存した CSV（Shift_JIS）と、Google スプレッドシートの CSV（UTF-8）の両方を読める。
 */

/** ファイルの中身を文字列にする。UTF-8 として読めなければ Shift_JIS として読む */
export function decodeCsv(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("shift_jis").decode(bytes);
  }
}

/** RFC 4180 の CSV を2次元配列にする（"…" の中のカンマ・改行・"" に対応） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  // 全部空の行は捨てる
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

function escape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** Excel で文字化けしない CSV（UTF-8 BOM 付き、CRLF） */
export function toCsv(rows: unknown[][]): string {
  return "﻿" + rows.map((r) => r.map(escape).join(",")).join("\r\n") + "\r\n";
}
