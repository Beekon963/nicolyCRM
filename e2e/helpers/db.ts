import pg from "pg";

/** 画面テストの準備用にローカル DB へ直接つなぐ（postgres 権限） */
const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres", max: 2 });

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query(text, params);
  return r.rows as T[];
}

export async function one<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T> {
  const rows = await sql<T>(text, params);
  if (!rows[0]) throw new Error(`行がありません: ${text}`);
  return rows[0];
}

/** 他のテストとぶつからない未来の日付（今日から 120〜300 日後） */
export async function freeFutureDate(): Promise<string> {
  const offset = 120 + Math.floor(Math.random() * 180);
  const r = await one<{ d: string }>(`select to_char(public.jst_today() + $1::int, 'YYYY-MM-DD') as d`, [offset]);
  return r.d;
}
