/**
 * スタッフ用マイページの DB 関数のテスト（docs/design/security.md §5）
 */
import { afterAll, describe, expect, it } from "vitest";
import { SENTINELS } from "../../scripts/seed/constants.mts";
import { asAdmin, asRole, closePool, getPool } from "./helpers";

afterAll(closePool);

type Fixture = { staffA: { id: string; token: string }; staffB: { id: string; token: string }; roleId: string; venueId: string; clientId: string };

/** 2人のスタッフと役割などを用意（読むだけ） */
async function fixture(): Promise<Fixture> {
  return asAdmin(async (c) => {
    const staff = (await c.query(`select id, mypage_token as token from public.staff where status = 'active' order by id limit 2`)).rows;
    const role = (await c.query(`select id from public.roles where name = 'クローザー'`)).rows[0];
    const venue = (await c.query(`select id from public.venues where address <> '' limit 1`)).rows[0];
    const client = (await c.query(`select id from public.companies where kind = 'client' limit 1`)).rows[0];
    return { staffA: staff[0], staffB: staff[1], roleId: role.id, venueId: venue.id, clientId: client.id };
  });
}

describe("マイページの公開範囲", () => {
  it("anon が実行できるのはマイページ用と見るだけリンク用の関数だけ", async () => {
    const rows = await asAdmin(async (c) =>
      (
        await c.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1`)
      ).rows.map((r) => r.proname),
    );
    expect(rows).toEqual([
      "mypage_availability_get",
      "mypage_availability_save",
      "mypage_history",
      "mypage_me",
      "mypage_offers",
      "mypage_report_get",
      "mypage_report_save",
      "mypage_reports",
      "mypage_respond",
      "mypage_schedule",
      "share_board",
    ]);
  });

  it("使えない鍵では何も返らない", async () => {
    const r = await asRole("anon", (c) => c.query(`select public.mypage_me('x'), public.mypage_offers(repeat('a', 43))`));
    expect(r.rows[0].mypage_me).toEqual({ error: "invalid_token" });
    expect(r.rows[0].mypage_offers).toEqual({ error: "invalid_token" });
  });

  it("終了したスタッフの鍵は使えない", async () => {
    await asRole("anon", async (c) => {
      await c.query("reset role");
      const s = (await c.query(`update public.staff set status = 'ended' where id = (select id from public.staff where status = 'active' limit 1) returning mypage_token`)).rows[0];
      await c.query("set local role anon");
      const r = await c.query(`select public.mypage_me($1) as me`, [s.mypage_token]);
      expect(r.rows[0].me).toEqual({ error: "invalid_token" });
    });
  });

  it("1人あたり1分120回を超えると少し待ってもらう", async () => {
    const f = await fixture();
    await asRole("anon", async (c) => {
      let last: unknown;
      for (let i = 0; i < 121; i++) last = (await c.query(`select public.mypage_me($1) as me`, [f.staffA.token])).rows[0].me;
      expect(last).toEqual({ error: "rate_limited" });
    });
  });
});

describe("打診への回答（自動確定・補欠）", () => {
  async function setupEvent(c: import("pg").PoolClient, f: Fixture, required: number, offsetDays = 30) {
    await c.query("reset role");
    const ev = (
      await c.query(`insert into public.events (client_id, venue_id, date) values ($1, $2, public.jst_today() + $3::int) returning id`, [f.clientId, f.venueId, offsetDays])
    ).rows[0];
    await c.query(`insert into public.event_requirements (event_id, role_id, required_count) values ($1, $2, $3)`, [ev.id, f.roleId, required]);
    const a = (
      await c.query(
        `insert into public.assignments (event_id, staff_id, role_id) values ($1, $2, $4), ($1, $3, $4) returning id, staff_id`,
        [ev.id, f.staffA.id, f.staffB.id, f.roleId],
      )
    ).rows;
    await c.query("set local role anon");
    return { eventId: ev.id, aId: a.find((x) => x.staff_id === f.staffA.id).id, bId: a.find((x) => x.staff_id === f.staffB.id).id };
  }

  it("空きがあれば確定、定員に達していれば補欠、できないなら辞退", async () => {
    const f = await fixture();
    await asRole("anon", async (c) => {
      const { aId, bId } = await setupEvent(c, f, 1);
      const r1 = await c.query(`select public.mypage_respond($1, $2, true) as r`, [f.staffA.token, aId]);
      expect(r1.rows[0].r).toEqual({ status: "confirmed" });
      const r2 = await c.query(`select public.mypage_respond($1, $2, true) as r`, [f.staffB.token, bId]);
      expect(r2.rows[0].r).toEqual({ status: "waitlisted" });
      // 回答済みはもう変わらない
      const r3 = await c.query(`select public.mypage_respond($1, $2, false) as r`, [f.staffA.token, aId]);
      expect(r3.rows[0].r).toEqual({ status: "confirmed", already: true });
    });
    await asRole("anon", async (c) => {
      const { aId } = await setupEvent(c, f, 2);
      const r = await c.query(`select public.mypage_respond($1, $2, false) as r`, [f.staffA.token, aId]);
      expect(r.rows[0].r).toEqual({ status: "declined" });
    });
  });

  it("他の人のアサインには回答できない", async () => {
    const f = await fixture();
    await asRole("anon", async (c) => {
      const { bId } = await setupEvent(c, f, 1);
      const r = await c.query(`select public.mypage_respond($1, $2, true) as r`, [f.staffA.token, bId]);
      expect(r.rows[0].r).toEqual({ error: "not_found" });
    });
  });

  it("残り1枠に2人が同時に「参加できる」を押しても、確定は1人だけ", async () => {
    const f = await fixture();
    const pool = getPool();
    const setup = await pool.connect();
    let ids: { eventId: string; aId: string; bId: string };
    try {
      await setup.query("begin");
      await setup.query("set local role postgres");
      ids = await setupEvent(setup, f, 1, 45);
      await setup.query("commit");
    } finally {
      setup.release();
    }
    const c1 = await pool.connect();
    const c2 = await pool.connect();
    try {
      await c1.query("begin");
      await c1.query("set local role anon");
      await c2.query("begin");
      await c2.query("set local role anon");
      // 1人目が先に押す（枠の行をロックしたまま、まだコミットしていない）
      const r1 = await c1.query(`select public.mypage_respond($1, $2, true) as r`, [f.staffA.token, ids!.aId]);
      // 2人目はロック待ちになる
      let finished = false;
      const p2 = c2.query(`select public.mypage_respond($1, $2, true) as r`, [f.staffB.token, ids!.bId]).then((r) => ((finished = true), r));
      await new Promise((r) => setTimeout(r, 300));
      expect(finished).toBe(false);
      await c1.query("commit");
      const r2 = await p2;
      await c2.query("commit");
      expect([r1.rows[0].r.status, r2.rows[0].r.status]).toEqual(["confirmed", "waitlisted"]);
    } finally {
      c1.release();
      c2.release();
      // 後片付け（このテストだけはコミットしているので消す）
      await pool.query(`delete from public.assignments where event_id = $1`, [ids!.eventId]);
      await pool.query(`delete from public.event_requirements where event_id = $1`, [ids!.eventId]);
      await pool.query(`delete from public.events where id = $1`, [ids!.eventId]);
    }
  });
});

describe("実績報告", () => {
  async function confirmedAssignment(c: import("pg").PoolClient, f: Fixture, offsetDays: number) {
    await c.query("reset role");
    const ev = (
      await c.query(`insert into public.events (client_id, venue_id, date) values ($1, $2, public.jst_today() + $3::int) returning id`, [f.clientId, f.venueId, offsetDays])
    ).rows[0];
    const a = (
      await c.query(`insert into public.assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed') returning id`, [ev.id, f.staffA.id, f.roleId])
    ).rows[0];
    const items = (await c.query(`select id from public.items where is_active order by sort_order limit 2`)).rows;
    await c.query("set local role anon");
    return { aId: a.id as string, items: items.map((i) => i.id as string) };
  }

  it("稼働日当日に件数・コメント・交通費を報告でき、期限内は修正できる", async () => {
    const f = await fixture();
    await asRole("anon", async (c) => {
      const { aId, items } = await confirmedAssignment(c, f, 0);
      const save = (count: number, transport: number) =>
        c.query(`select public.mypage_report_save($1, $2, $3, 'よく売れた', $4, '大宮〜浦和', 0, '') as r`, [
          f.staffA.token,
          aId,
          JSON.stringify(items.map((item_id) => ({ item_id, count }))),
          transport,
        ]);
      expect((await save(3, 640)).rows[0].r).toEqual({ ok: true });
      expect((await save(4, 0)).rows[0].r).toEqual({ ok: true });
      const got = (await c.query(`select public.mypage_report_get($1, $2) as r`, [f.staffA.token, aId])).rows[0].r;
      expect(got.editable).toBe(true);
      expect(got.comment).toBe("よく売れた");
      expect(got.items.filter((i: { reported: number }) => i.reported === 4)).toHaveLength(2);
      // 交通費を 0 にしたら申請は消える
      expect(got.expenses).toEqual({});

      // 変更履歴にスタッフ本人の操作として残る
      await c.query("reset role");
      const log = await c.query(`select * from public.audit_logs where table_name = 'report_items' and row_id like $1 || ':%'`, [aId]);
      expect(log.rows.length).toBeGreaterThan(0);
      expect(log.rows.every((l) => l.staff_id === f.staffA.id && l.user_id === null)).toBe(true);
    });
  });

  it("期限を過ぎた・まだ稼働日前・管理者が確定済みなら報告できない", async () => {
    const f = await fixture();
    await asRole("anon", async (c) => {
      const old = await confirmedAssignment(c, f, -8);
      const r1 = await c.query(`select public.mypage_report_save($1, $2, '[]', '', 0, '', 0, '') as r`, [f.staffA.token, old.aId]);
      expect(r1.rows[0].r).toEqual({ error: "out_of_window" });

      const future = await confirmedAssignment(c, f, 1);
      const r2 = await c.query(`select public.mypage_report_save($1, $2, '[]', '', 0, '', 0, '') as r`, [f.staffA.token, future.aId]);
      expect(r2.rows[0].r).toEqual({ error: "out_of_window" });

      const today = await confirmedAssignment(c, f, 0);
      await c.query("reset role");
      await c.query(`insert into public.reports (assignment_id, submitted_at, confirmed_at) values ($1, now(), now())`, [today.aId]);
      await c.query("set local role anon");
      const r3 = await c.query(`select public.mypage_report_save($1, $2, '[]', '', 0, '', 0, '') as r`, [f.staffA.token, today.aId]);
      expect(r3.rows[0].r).toEqual({ error: "already_confirmed" });
    });
  });

  it("他の人のアサインには報告できない", async () => {
    const f = await fixture();
    await asRole("anon", async (c) => {
      const { aId } = await confirmedAssignment(c, f, 0);
      const r = await c.query(`select public.mypage_report_save($1, $2, '[]', '', 0, '', 0, '') as r`, [f.staffB.token, aId]);
      expect(r.rows[0].r).toEqual({ error: "not_found" });
      const g = await c.query(`select public.mypage_report_get($1, $2) as r`, [f.staffB.token, aId]);
      expect(g.rows[0].r).toEqual({ error: "not_found" });
    });
  });
});

describe("稼働可能日", () => {
  it("翌月分を提出でき、今日より前の日は変わらない。対象外の月は扱わない", async () => {
    const f = await fixture();
    // anon は jst_today() も呼べないので、日付は先に postgres で求める
    const m = await asAdmin(async (c) =>
      (await c.query(`select to_char(date_trunc('month', public.jst_today()) + interval '1 month', 'YYYY-MM-DD') as m,
                             to_char(public.jst_today() - 1, 'YYYY-MM-DD') as yesterday,
                             to_char(date_trunc('month', public.jst_today()), 'YYYY-MM-DD') as this_m`)).rows[0],
    );
    await asRole("anon", async (c) => {
      const next1 = m.m;
      const days = { [next1]: "ok", [next1.slice(0, 8) + "02"]: "maybe", [next1.slice(0, 8) + "03"]: null };
      const r = await c.query(`select public.mypage_availability_save($1, $2, $3, '土日は午後から', true) as r`, [f.staffA.token, next1, JSON.stringify(days)]);
      expect(r.rows[0].r).toEqual({ ok: true });
      const got = (await c.query(`select public.mypage_availability_get($1, $2) as r`, [f.staffA.token, next1])).rows[0].r;
      expect(got.days[next1]).toBe("ok");
      expect(got.memo).toBe("土日は午後から");
      expect(got.submitted_at).not.toBeNull();

      // 昨日は変えられない
      await c.query("reset role");
      await c.query(`delete from public.availability where staff_id = $1 and date = $2`, [f.staffA.id, m.yesterday]);
      await c.query("set local role anon");
      await c.query(`select public.mypage_availability_save($1, $2, $3, '', false)`, [f.staffA.token, m.this_m, JSON.stringify({ [m.yesterday]: "ok" })]);
      await c.query("reset role");
      const y = await c.query(`select * from public.availability where staff_id = $1 and date = $2`, [f.staffA.id, m.yesterday]);
      expect(y.rowCount).toBe(0);
      await c.query("set local role anon");

      const out = await c.query(`select public.mypage_availability_get($1, '2020-01-01') as r`, [f.staffA.token]);
      expect(out.rows[0].r).toEqual({ error: "out_of_range" });
    });
  });
});

describe("マイページに金額は出ない", () => {
  it("どの関数の結果にも日当・単価などの目印が含まれない", async () => {
    // 目印の日当を持つスタッフ（seed の1人目）の鍵で、すべての関数を呼ぶ
    const token = await asAdmin(async (c) => (await c.query(`select mypage_token from public.staff where phone = '090-0000-0001'`)).rows[0].mypage_token);
    const m = await asAdmin(async (c) => (await c.query(`select to_char(date_trunc('month', public.jst_today()), 'YYYY-MM-DD') as m`)).rows[0].m);
    const out = await asRole("anon", async (c) => {
      const r = await c.query(
        `select public.mypage_me($1) a, public.mypage_offers($1) b, public.mypage_schedule($1) c, public.mypage_reports($1) d,
                public.mypage_history($1) e, public.mypage_availability_get($1, $2) f`,
        [token, m],
      );
      const reports = r.rows[0].d.items as { assignment_id: string }[];
      const details = await Promise.all(reports.map((x) => c.query(`select public.mypage_report_get($1, $2) as r`, [token, x.assignment_id])));
      return JSON.stringify([r.rows[0], details.map((d) => d.rows[0].r)]);
    });
    for (const s of Object.values(SENTINELS)) expect(out).not.toContain(String(s));
    expect(out).not.toMatch(/daily_rate|base_daily|incentive|account_number|withholding/);
  });
});
