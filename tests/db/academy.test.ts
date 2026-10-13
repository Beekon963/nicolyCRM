/**
 * Phase 14: NICOLY アカデミーの進み具合（academy_progress）。
 * お金の情報ではないので、オーナー・管理者が読める・取り込める。ログインしていない人・無効化した管理者は読めない
 */
import { afterAll, describe, expect, it } from "vitest";
import { SEED_USERS } from "../../scripts/seed/constants.mts";
import { asRole, closePool, tryQuery } from "./helpers";

afterAll(closePool);

const FREE = `select id from public.staff where id not in (select staff_id from public.academy_progress) order by id`;

describe("アカデミーの進み具合", () => {
  it("ダミーデータに入っている（称号・分野・稼働判断）", async () => {
    await asRole("owner", async (c) => {
      const r = (await c.query(`select count(*)::int as n, count(*) filter (where decision = 'ready')::int as ready from public.academy_progress`)).rows[0];
      expect(r.n).toBeGreaterThan(10);
      expect(r.ready).toBeGreaterThan(0);
      const areas = (await c.query(`select areas from public.academy_progress order by staff_id limit 1`)).rows[0].areas;
      expect(areas[0]).toMatchObject({ name: "携帯", total: 8 });
    });
  });

  it("管理者も読める・取り込める・直せる・外せる。取り込んだ人が残る", async () => {
    await asRole("manager", async (c) => {
      const s = (await c.query(`${FREE} limit 1`)).rows[0];
      await c.query(
        `insert into public.academy_progress (staff_id, academy_id, title, decision, areas)
         values ($1, 'test-learner', '携帯を案内できる', 'ready', '[{"name":"携帯","done":8,"total":8,"test":true}]')`,
        [s.id],
      );
      const r = (await c.query(`select title, decision, imported_by from public.academy_progress where staff_id = $1`, [s.id])).rows[0];
      expect(r).toEqual({ title: "携帯を案内できる", decision: "ready", imported_by: SEED_USERS.manager.id });
      expect((await c.query(`update public.academy_progress set decision = 'hold' where staff_id = $1`, [s.id])).rowCount).toBe(1);
      expect((await c.query(`delete from public.academy_progress where staff_id = $1`, [s.id])).rowCount).toBe(1);
    });
  });

  it("1つのログインは1人のスタッフだけ。稼働判断・数はおかしな値を入れられない", async () => {
    await asRole("owner", async (c) => {
      const [a, b] = (await c.query(`${FREE} limit 2`)).rows;
      await c.query(`insert into public.academy_progress (staff_id, academy_id) values ($1, 'dup-learner')`, [a.id]);
      expect((await tryQuery(c, `insert into public.academy_progress (staff_id, academy_id) values ($1, 'dup-learner')`, [b.id])).ok).toBe(false);
      expect((await tryQuery(c, `insert into public.academy_progress (staff_id, academy_id, decision) values ($1, 'other', 'maybe')`, [b.id])).ok).toBe(false);
      expect((await tryQuery(c, `insert into public.academy_progress (staff_id, academy_id, field_done) values ($1, 'other', -1)`, [b.id])).ok).toBe(false);
      expect((await tryQuery(c, `insert into public.academy_progress (staff_id, academy_id, areas) values ($1, 'other', '{}')`, [b.id])).ok).toBe(false);
      expect((await tryQuery(c, `insert into public.academy_progress (staff_id, academy_id) values ($1, '  ')`, [b.id])).ok).toBe(false);
    });
  });

  it("ログインしていない人・無効化した管理者は読めない", async () => {
    const anon = await asRole("anon", (c) => tryQuery(c, `select * from public.academy_progress limit 1`));
    expect(anon.ok).toBe(false);
    const n = await asRole("inactive", async (c) => (await c.query(`select count(*)::int as n from public.academy_progress`)).rows[0].n);
    expect(n).toBe(0);
    const write = await asRole("inactive", async (c) => {
      const s = (await c.query(`select id from public.staff limit 1`)).rows[0];
      return tryQuery(c, `insert into public.academy_progress (staff_id, academy_id) values ($1, 'inactive-learner')`, [s?.id ?? "00000000-0000-4000-8000-000000000000"]);
    });
    expect(write.ok).toBe(false);
  });
});
