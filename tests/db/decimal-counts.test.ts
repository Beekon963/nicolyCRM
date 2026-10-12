/**
 * 獲得件数は小数第2位まで（Phase 11。2人で取った件数は人数で割る: 0.5件・0.33件）。
 * スタッフ別の平均獲得件数（候補を探す画面）にも小数のまま入る
 */
import { afterAll, describe, expect, it } from "vitest";
import { asAdmin, closePool, tryQuery } from "./helpers";

afterAll(closePool);

describe("小数の件数", () => {
  it("0.5件・0.33件を入れられ、マイナスは入れられない。平均獲得件数にも入る", async () => {
    await asAdmin(async (c) => {
      const staff = (await c.query(`select id from public.staff where status = 'active' order by id limit 1`)).rows[0];
      const role = (await c.query(`select id from public.roles where name = 'クローザー'`)).rows[0];
      const client = (await c.query(`select id from public.companies where kind = 'client' limit 1`)).rows[0];
      const venue = (await c.query(`select id from public.venues order by id limit 1`)).rows[0];
      const items = (await c.query(`select id from public.items where is_active order by sort_order limit 2`)).rows;
      const ev = (await c.query(`insert into public.events (client_id, venue_id, date, report_required) values ($1, $2, public.jst_today() - 400, false) returning id`, [client.id, venue.id])).rows[0];
      const a = (await c.query(`insert into public.assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed') returning id`, [ev.id, staff.id, role.id])).rows[0];
      await c.query(`insert into public.reports (assignment_id, submitted_at, confirmed_at, source) values ($1, now(), now(), 'admin')`, [a.id]);
      await c.query(`insert into public.report_items (assignment_id, item_id, reported_count, confirmed_count) values ($1, $2, 0.5, 0.5), ($1, $3, 0.33, 0.33)`, [a.id, items[0].id, items[1].id]);
      const rows = (await c.query(`select reported_count, confirmed_count from public.report_items where assignment_id = $1 order by confirmed_count`, [a.id])).rows;
      expect(rows).toEqual([
        { reported_count: 0.33, confirmed_count: 0.33 },
        { reported_count: 0.5, confirmed_count: 0.5 },
      ]);
      await c.query("savepoint s");
      expect((await tryQuery(c, `update public.report_items set confirmed_count = -0.5 where assignment_id = $1`, [a.id])).ok).toBe(false);
      await c.query("rollback to savepoint s");
      const avg = (await c.query(`select avg_confirmed from public.staff_avg_confirmed(public.jst_today() - 401) where staff_id = $1`, [staff.id])).rows[0];
      expect(avg.avg_confirmed).toBeGreaterThan(0);
    });
  });
});
