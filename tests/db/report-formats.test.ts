/**
 * 日報のフォーマット（Phase 4-1）: オーナーだけが作る・直す。管理者は読める（日報を作るため）。
 * マイページの報告では、その現場の取引先で使う書式（スタッフにも出すもの）と、本人の名前・取引先の名前だけが返る。
 */
import { afterAll, describe, expect, it } from "vitest";
import { asRole, closePool, tryQuery } from "./helpers";

afterAll(closePool);

describe("日報のフォーマット", () => {
  it("オーナーは作れる・直せる。管理者は読めるが作れない・直せない。ログインしていない人は読めない", async () => {
    await asRole("owner", async (c) => {
      const r = await tryQuery(c, `insert into public.report_formats (name, person_block) values ('テスト用', '{名前}') returning id`);
      expect(r.ok).toBe(true);
    });
    await asRole("manager", async (c) => {
      expect((await c.query(`select count(*)::int as n from public.report_formats`)).rows[0].n).toBeGreaterThan(0);
      expect((await tryQuery(c, `insert into public.report_formats (name, person_block) values ('管理者', '{名前}')`)).ok).toBe(false);
      const upd = await tryQuery(c, `update public.report_formats set name = 'x' returning id`);
      expect(upd.ok && upd.rowCount > 0).toBe(false);
    });
    await asRole("anon", async (c) => {
      expect((await tryQuery(c, `select * from public.report_formats`)).ok).toBe(false);
    });
  });

  it("マイページの報告に、その取引先の書式（スタッフにも出すもの）と名前が入る。ほかの取引先の書式・出さない書式は入らない", async () => {
    await asRole("anon", async (c) => {
      await c.query("reset role");
      const staff = (await c.query(`select id, name, mypage_token as token from public.staff where status = 'active' order by id limit 1`)).rows[0];
      const clients = (await c.query(`select id, name from public.companies where kind = 'client' order by id limit 2`)).rows;
      const role = (await c.query(`select id from public.roles where name = 'クローザー'`)).rows[0];
      const venue = (await c.query(`select id from public.venues limit 1`)).rows[0];
      const ev = (await c.query(`insert into public.events (client_id, venue_id, date) values ($1, $2, public.jst_today()) returning id`, [clients[0].id, venue.id])).rows[0];
      const a = (await c.query(`insert into public.assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed') returning id`, [ev.id, staff.id, role.id])).rows[0];
      await c.query(
        `insert into public.report_formats (name, company_id, for_staff, person_block) values
           ('この取引先用', $1, true, '{名前}'), ('ほかの取引先用', $2, true, '{名前}'), ('管理者だけ', null, false, '{名前}')`,
        [clients[0].id, clients[1].id],
      );
      await c.query("set local role anon");
      const got = (await c.query(`select public.mypage_report_get($1, $2) as r`, [staff.token, a.id])).rows[0].r;
      expect(got.staff_name).toBe(staff.name);
      expect(got.client_name).toBe(clients[0].name);
      const names = got.formats.map((f: { name: string }) => f.name);
      expect(names[0]).toBe("この取引先用");
      expect(names).toContain("NICOLY用");
      expect(names).not.toContain("ほかの取引先用");
      expect(names).not.toContain("管理者だけ");
    });
  });
});
