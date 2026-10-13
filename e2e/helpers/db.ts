import pg from "pg";

// 獲得件数（numeric。Phase 11 で小数第2位まで）を数として読む（そのままだと "2.00" の文字になる）
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));

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
    await c.query(`delete from line_outbox where assignment_id in ${a}`, [eventId]);
    await c.query(`delete from assignment_alerts where assignment_id in ${a}`, [eventId]);
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

/**
 * 取引先・会場・役割を1つずつ選んで、指定日の現場を作る。
 * 取引先に書式などを付けるテストは clientId（makeClient で作ったもの）を渡す（みんなが使う取引先に付けると、ほかのテストの画面に出てしまうため）
 */
export async function makeEvent(dateExpr: string, opts: { required?: number; place?: string; clientId?: string } = {}) {
  const closer = await one<{ id: string }>(`select id from roles where name = 'クローザー'`);
  const ev = await one<{ id: string; venue: string }>(
    `insert into events (client_id, venue_id, date, start_time, end_time, meeting_place)
     values (coalesce($2::uuid, (select id from companies where kind = 'client' and not exists (select 1 from company_items ci where ci.company_id = companies.id) limit 1)),
             (select id from venues where address <> '' order by random() limit 1), ${dateExpr}, '10:00', '19:00', $1)
     returning id, (select name from venues where id = venue_id) as venue`,
    [opts.place ?? "", opts.clientId ?? null],
  );
  if (opts.required) await sql(`insert into event_requirements (event_id, role_id, required_count) values ($1, $2, $3)`, [ev.id, closer.id, opts.required]);
  return { ...ev, roleId: closer.id };
}

/** 英小文字だけの印（名前の最後が数字だと、報告の文の「〇〇2」の件数と見分けにくいため） */
export function letters(n = 4): string {
  return Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
}

export type TestStaff = { id: string; name: string; token: string };

/**
 * テスト専用のスタッフを作る（役割は初めはクローザー）。
 * ダミーデータのスタッフをくじ引きで選ぶと、同時に動くほかのテストと同じ人を選んで、予定・稼働可能日・報告が混ざることがあるため、
 * テストで予定や報告を入れる人は、そのテストで作る。名前は「姓 名＋英字4文字」で重ならない。終わったら dropStaff で消す
 */
export async function makeStaff(name = "検証 太郎", opts: { roles?: string[]; rank?: string } = {}): Promise<TestStaff> {
  const s = await one<TestStaff>(
    `insert into staff (name, kana, rank_id) values ($1, 'けんしょう', (select id from ranks where name = $2)) returning id, name, mypage_token as token`,
    [`${name}${letters()}`, opts.rank ?? null],
  );
  for (const role of opts.roles ?? ["クローザー"]) {
    await sql(`insert into staff_roles (staff_id, role_id) select $1, id from roles where name = $2`, [s.id, role]);
  }
  return s;
}

/** makeStaff で作ったスタッフを、予定・報告・稼働可能日などといっしょに消す（現場は cleanupEvent で消す） */
export async function dropStaff(...ids: (string | undefined)[]) {
  const list = ids.filter((id): id is string => !!id);
  if (!list.length) return;
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local session_replication_role = replica");
    const a = `(select id from assignments where staff_id = any($1))`;
    for (const t of ["report_items", "reports", "expenses", "staff_notes", "assignment_private", "line_outbox", "assignment_alerts"]) {
      await c.query(`delete from ${t} where assignment_id in ${a}`, [list]);
    }
    await c.query(`delete from assignments where staff_id = any($1)`, [list]);
    await c.query(`delete from referral_bonuses where referred_staff_id = any($1) or referrer_staff_id = any($1)`, [list]);
    for (const t of ["expenses", "staff_notes", "availability", "availability_submissions", "staff_ng", "staff_roles", "staff_areas", "staff_private", "academy_progress", "line_link_codes", "payment_adjustments", "payments"]) {
      await c.query(`delete from ${t} where staff_id = any($1)`, [list]);
    }
    await c.query(`update staff set referred_by = null where referred_by = any($1)`, [list]);
    await c.query(`delete from staff where id = any($1)`, [list]);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

/** テスト専用の取引先（書式・獲得項目などを付けるテスト用）。終わったら dropClient で消す */
export async function makeClient(name = "E2E取引先"): Promise<{ id: string; name: string }> {
  return one(`insert into companies (kind, name, status) values ('client', $1, 'active') returning id, name`, [`${name}${letters()}`]);
}

/** makeClient で作った取引先を、書式・獲得項目・言いかえといっしょに消す（現場は先に cleanupEvent で消す） */
export async function dropClient(id: string | undefined) {
  if (!id) return;
  for (const t of ["report_formats", "company_items", "item_aliases", "client_rates", "company_billing", "company_links", "staff_ng", "activities", "contacts"]) {
    await sql(`delete from ${t} where company_id = $1`, [id]);
  }
  await sql(`delete from companies where id = $1`, [id]);
}
