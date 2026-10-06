/**
 * DB テスト用の共通処理。ローカルの Supabase（npm run db:start → npm run db:reset）が必要。
 *
 * - asRole(): 1つのトランザクションの中で、指定した利用者として SQL を実行し、最後に必ず元に戻す
 *   （テストでデータを書き換えても DB には残らない）
 * - localSupabase(): ローカル Supabase の URL とキー（supabase status から取得）
 */
import { execSync } from "node:child_process";
import pg from "pg";
import { SEED_USERS } from "../../scripts/seed/constants.mts";

export const DB_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export type Actor = "owner" | "manager" | "inactive" | "anon";

let pool: pg.Pool | null = null;
export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: DB_URL, max: 4 });
  return pool;
}

export async function closePool() {
  await pool?.end();
  pool = null;
}

/** 利用者として SQL を実行する。fn の中で投げた例外もそのまま返し、最後にロールバックする */
export async function asRole<T>(actor: Actor, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    if (actor === "anon") {
      await client.query("set local role anon");
      await client.query(`select set_config('request.jwt.claims', '{"role":"anon"}', true)`);
    } else {
      const id = SEED_USERS[actor].id;
      await client.query("set local role authenticated");
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: id, role: "authenticated", email: SEED_USERS[actor].email }),
      ]);
    }
    return await fn(client);
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
}

/** postgres（管理者権限）として読むだけ */
export async function asAdmin<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    return await fn(client);
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
}

/** savepoint で囲んで、エラーになるはずの SQL を試す */
export async function tryQuery(c: pg.PoolClient, sql: string, params: unknown[] = []) {
  await c.query("savepoint t");
  try {
    const r = await c.query(sql, params);
    await c.query("release savepoint t");
    return { ok: true as const, rows: r.rows, rowCount: r.rowCount ?? 0 };
  } catch (e) {
    await c.query("rollback to savepoint t");
    return { ok: false as const, error: (e as Error).message };
  }
}

let status: { API_URL: string; PUBLISHABLE_KEY: string; SECRET_KEY: string } | null = null;
export function localSupabase() {
  if (!status) {
    try {
      const out = execSync("npx supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      status = JSON.parse(out.slice(out.indexOf("{")));
    } catch {
      throw new Error("ローカルの Supabase が起動していません。`npm run db:start` と `npm run db:reset` を実行してください。");
    }
  }
  return status!;
}
