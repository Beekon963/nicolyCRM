/**
 * 検索用の正規化。DB の public.search_norm() / digits_only() / company_key() と同じ規則にする。
 * ひらがな / カタカナ、全角 / 半角、空白、電話番号のハイフンの違いを吸収する（要件 §4.11）。
 */

export function searchNorm(text: string | null | undefined): string {
  return (text ?? "")
    .normalize("NFKC")
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .toLowerCase()
    .replace(/\s+/g, "");
}

export function digitsOnly(text: string | null | undefined): string {
  return (text ?? "").normalize("NFKC").replace(/[^0-9]/g, "");
}

/** 会社名の重複判定用（「株式会社」「(株)」などを除く） */
export function companyKey(name: string | null | undefined): string {
  return searchNorm(
    (name ?? "")
      .normalize("NFKC")
      .replace(/株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|\(株\)|\(有\)|\(同\)|\(資\)|\(名\)|[・.,､、。]/g, ""),
  );
}

/** 検索語に一致するか（名前・かなは正規化して部分一致、電話番号は数字だけで部分一致） */
export function matchesQuery(q: string, fields: { text?: (string | null | undefined)[]; phone?: (string | null | undefined)[] }) {
  const nq = searchNorm(q);
  if (!nq) return true;
  if ((fields.text ?? []).some((t) => searchNorm(t).includes(nq))) return true;
  const dq = digitsOnly(q);
  return dq.length >= 3 && (fields.phone ?? []).some((p) => digitsOnly(p).includes(dq));
}

/** PostgREST の ilike 用（% と _ をエスケープ） */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
