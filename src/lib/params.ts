/** searchParams から必要なキーだけを文字列で取り出す */
export function pickParams<K extends string>(
  sp: Record<string, string | string[] | undefined>,
  keys: readonly K[],
): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const k of keys) {
    const v = sp[k];
    const s = Array.isArray(v) ? v[0] : v;
    if (s) out[k] = s;
  }
  return out;
}
