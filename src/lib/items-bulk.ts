/**
 * 獲得項目のまとめて登録（Phase 8）。取引先からもらった公認名称の一覧を貼って使う。
 * 画面（件数の表示）とサーバー（登録）で同じ読み方をする
 */

/** 貼り付けた一覧を項目名の並びにする（空の行・【】の見出しの行・「獲得名」などの見出しは使わない。同じ名前は1つに） */
export function itemLines(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim().replace(/^[・\-*●○]\s*/, "");
    if (!t || /^[【\[［].*[】\]］]$/.test(t) || /^(獲得名|項目名|名称|項目)$/.test(t) || t.length > 60) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** 光・カードの項目に「（仮）」の項目も足す（仮申し込みを分けて数えるため）。すぐ下に足す */
export function withProvisional(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    out.push(l);
    if (/光|カード/.test(l) && !/[（(]仮[)）]/.test(l) && !lines.includes(`${l}（仮）`)) out.push(`${l}（仮）`);
  }
  return out;
}
