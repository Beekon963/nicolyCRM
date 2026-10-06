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

/** テストで作った現場を関連データごと消す（今日の日付で作ったものがホームに残らないように） */
export async function cleanupEvent(eventId: string) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local session_replication_role = replica");
    const a = `(select id from assignments where event_id = $1)`;
    for (const t of ["report_items", "reports", "expenses", "staff_notes", "assignment_private"]) {
      await c.query(`delete from ${t} where assignment_id in ${a}`, [eventId]);
    }
    await c.query(`delete from assignments where event_id = $1`, [eventId]);
    await c.query(`delete from event_requirements where event_id = $1`, [eventId]);
    await c.query(`delete from events where id = $1`, [eventId]);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

/** 取引先・会場・役割・スタッフを1つずつ選んで、指定日の現場を作る */
export async function makeEvent(dateExpr: string, opts: { required?: number; place?: string } = {}) {
  const closer = await one<{ id: string }>(`select id from roles where name = 'クローザー'`);
  const ev = await one<{ id: string; venue: string }>(
    `insert into events (client_id, venue_id, date, start_time, end_time, meeting_place)
     values ((select id from companies where kind = 'client' and not exists (select 1 from company_items ci where ci.company_id = companies.id) limit 1),
             (select id from venues where address <> '' order by random() limit 1), ${dateExpr}, '10:00', '19:00', $1)
     returning id, (select name from venues where id = venue_id) as venue`,
    [opts.place ?? ""],
  );
  if (opts.required) await sql(`insert into event_requirements (event_id, role_id, required_count) values ($1, $2, $3)`, [ev.id, closer.id, opts.required]);
  return { ...ev, roleId: closer.id };
}
