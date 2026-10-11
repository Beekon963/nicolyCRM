/**
 * LINE のお知らせ（Phase 5）: つなぐコード・つなぐ処理・送る記録の権限。
 * - スタッフはマイページの鍵で自分のコードだけ出せる。コードは30分・1回だけ
 * - コードを使ってつなぐのはサーバー（秘密キー）だけ。同じ LINE はほかの人から外す
 * - 送った記録はメンバーが読めるが、入れる・直すのはサーバーだけ
 * - 前日のお知らせは、その日の確定した人に1回だけ入る
 */
import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { asRole, closePool, tryQuery } from "./helpers";

afterAll(closePool);

const LINE_A = `U${"a".repeat(32)}`;
const LINE_B = `U${"b".repeat(32)}`;

async function asService<T>(c: pg.PoolClient, fn: () => Promise<T>) {
  await c.query("reset role");
  await c.query("set local role service_role");
  try {
    return await fn();
  } finally {
    await c.query("reset role");
  }
}

describe("LINE とつなぐ", () => {
  it("スタッフはマイページの鍵でコードを出せる。出し直すと前のコードは消える。使えない鍵では出せない", async () => {
    await asRole("anon", async (c) => {
      await c.query("reset role");
      const s = (await c.query(`select id, mypage_token as token from public.staff where status = 'active' order by id limit 1`)).rows[0];
      await c.query("set local role anon");
      const r1 = (await c.query(`select public.mypage_line_link($1) as r`, [s.token])).rows[0].r;
      expect(r1.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      const r2 = (await c.query(`select public.mypage_line_link($1) as r`, [s.token])).rows[0].r;
      await c.query("reset role");
      const codes = (await c.query(`select code from public.line_link_codes where staff_id = $1 and used_at is null`, [s.id])).rows;
      expect(codes.map((x) => x.code)).toEqual([r2.code]);
      await c.query("set local role anon");
      expect((await c.query(`select public.mypage_line_link(repeat('x', 43)) as r`)).rows[0].r).toEqual({ error: "invalid_token" });
    });
  });

  it("コードでつなぐのはサーバーだけ。1回使ったら使えない・期限切れも使えない。同じ LINE は前の人から外す", async () => {
    await asRole("anon", async (c) => {
      await c.query("reset role");
      const [s1, s2] = (await c.query(`select id, mypage_token as token from public.staff where status = 'active' order by id limit 2`)).rows;
      await c.query("set local role anon");
      expect((await tryQuery(c, `select public.line_link_consume('ABCDEFGH', $1)`, [LINE_A])).ok).toBe(false);
      const code1 = (await c.query(`select public.mypage_line_link($1) as r`, [s1.token])).rows[0].r.code;
      const code2 = (await c.query(`select public.mypage_line_link($1) as r`, [s2.token])).rows[0].r.code;

      await asService(c, async () => {
        expect((await c.query(`select public.line_link_consume($1, 'not-a-line-id') as r`, [code1])).rows[0].r).toEqual({ error: "invalid" });
        const ok1 = (await c.query(`select public.line_link_consume($1, $2) as r`, [code1.toLowerCase(), LINE_A])).rows[0].r;
        expect(ok1).toMatchObject({ ok: true, kind: "staff" });
        expect((await c.query(`select public.line_link_consume($1, $2) as r`, [code1, LINE_B])).rows[0].r).toEqual({ error: "not_found" });
        // 同じ LINE で別のスタッフのコードを使うと、前の人からは外れる
        expect((await c.query(`select public.line_link_consume($1, $2) as r`, [code2, LINE_A])).rows[0].r.ok).toBe(true);
      });
      const ids = (await c.query(`select id, line_user_id from public.staff where id in ($1, $2)`, [s1.id, s2.id])).rows;
      expect(ids.find((x) => x.id === s1.id).line_user_id).toBeNull();
      expect(ids.find((x) => x.id === s2.id).line_user_id).toBe(LINE_A);

      await c.query(`update public.line_link_codes set expires_at = now() - interval '1 minute' where staff_id = $1`, [s1.id]);
      await c.query("set local role anon");
      const code3 = (await c.query(`select public.mypage_line_link($1) as r`, [s1.token])).rows[0].r.code;
      await c.query("reset role");
      await c.query(`update public.line_link_codes set expires_at = now() - interval '1 minute' where code = $1`, [code3]);
      await asService(c, async () => {
        expect((await c.query(`select public.line_link_consume($1, $2) as r`, [code3, LINE_B])).rows[0].r).toEqual({ error: "not_found" });
      });

      // ブロックされたら外す・本人がつなぐのをやめる
      await asService(c, () => c.query(`select public.line_unlink_user($1)`, [LINE_A]));
      expect((await c.query(`select line_user_id from public.staff where id = $1`, [s2.id])).rows[0].line_user_id).toBeNull();
    });
  });

  it("オーナー・管理者は自分のコードを出せる。ログインしていない人は出せない", async () => {
    await asRole("manager", async (c) => {
      const code = (await c.query(`select public.line_link_code_for_me() as c`)).rows[0].c;
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      expect((await c.query(`select count(*)::int as n from public.line_link_codes`)).rows[0].n).toBe(1);
    });
    await asRole("anon", async (c) => {
      expect((await tryQuery(c, `select public.line_link_code_for_me()`)).ok).toBe(false);
      expect((await tryQuery(c, `select * from public.line_link_codes`)).ok).toBe(false);
    });
  });
});

describe("LINE の送る記録", () => {
  it("メンバーは読めるが、入れる・直すのはサーバーだけ。ログインしていない人は読めない", async () => {
    await asRole("manager", async (c) => {
      expect((await tryQuery(c, `select * from public.line_outbox limit 1`)).ok).toBe(true);
      expect((await tryQuery(c, `insert into public.line_outbox (kind, event_ids) values ('admin_events', '{}')`)).ok).toBe(false);
      const upd = await tryQuery(c, `update public.line_outbox set status = 'sent' returning id`);
      expect(upd.ok && upd.rowCount > 0).toBe(false);
      expect((await tryQuery(c, `select public.line_enqueue_reminders(public.jst_today())`)).ok).toBe(false);
    });
    await asRole("anon", async (c) => {
      expect((await tryQuery(c, `select * from public.line_outbox limit 1`)).ok).toBe(false);
    });
  });

  it("「元に戻す」でアサインが消えたら、送る前のお知らせも消える（間違えた確定のお知らせを送らない）", async () => {
    await asRole("owner", async (c) => {
      await c.query("reset role");
      const s = (await c.query(`select id from public.staff where status = 'active' order by id limit 1`)).rows[0];
      const role = (await c.query(`select id from public.roles order by sort_order limit 1`)).rows[0];
      const ev = (await c.query(`insert into public.events (client_id, venue_id, date) values ((select id from public.companies where kind = 'client' limit 1), (select id from public.venues limit 1), public.jst_today() + 210) returning id`)).rows[0];
      const a = (await c.query(`insert into public.assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'offered') returning id`, [ev.id, s.id, role.id])).rows[0];
      await c.query(`insert into public.line_outbox (kind, assignment_id) values ('confirm', $1), ('admin_confirm', $1)`, [a.id]);
      await c.query(`delete from public.assignments where id = $1`, [a.id]);
      expect((await c.query(`select count(*)::int as n from public.line_outbox where assignment_id = $1`, [a.id])).rows[0].n).toBe(0);
    });
  });

  it("前日のお知らせは、その日の確定した人（中止でない現場）に1回だけ入る", async () => {
    await asRole("owner", async (c) => {
      await c.query("reset role");
      const staff = (await c.query(`select id from public.staff where status = 'active' order by id limit 3`)).rows;
      const role = (await c.query(`select id from public.roles order by sort_order limit 1`)).rows[0];
      const client = (await c.query(`select id from public.companies where kind = 'client' limit 1`)).rows[0];
      const venue = (await c.query(`select id from public.venues limit 1`)).rows[0];
      const day = (await c.query(`select (public.jst_today() + 200)::text as d`)).rows[0].d;
      const ev = (await c.query(`insert into public.events (client_id, venue_id, date) values ($1, $2, $3) returning id`, [client.id, venue.id, day])).rows[0];
      const a = (
        await c.query(
          `insert into public.assignments (event_id, staff_id, role_id, status) values ($1, $2, $5, 'confirmed'), ($1, $3, $5, 'offered'), ($1, $4, $5, 'confirmed') returning id, status`,
          [ev.id, staff[0].id, staff[1].id, staff[2].id, role.id],
        )
      ).rows;
      await c.query(`update public.assignments set reminder_sent_at = now() where id = $1`, [a[2].id]);
      const n1 = await asService(c, async () => (await c.query(`select public.line_enqueue_reminders($1) as n`, [day])).rows[0].n);
      const n2 = await asService(c, async () => (await c.query(`select public.line_enqueue_reminders($1) as n`, [day])).rows[0].n);
      expect([n1, n2]).toEqual([1, 0]);
      const rows = (await c.query(`select assignment_id from public.line_outbox where kind = 'reminder' and assignment_id = any($1)`, [a.map((x) => x.id)])).rows;
      expect(rows.map((r) => r.assignment_id)).toEqual([a[0].id]);
    });
  });
});
