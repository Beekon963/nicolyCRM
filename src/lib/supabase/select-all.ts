/**
 * 1000行を超えるかもしれない一覧を全部取る（Supabase は1回に最大1000行しか返さない）。
 * make には並び順（order）を必ず付けること。順番が決まっていないとページの境目で行が抜ける。
 */
export async function selectAll<T>(
  make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await make(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}
