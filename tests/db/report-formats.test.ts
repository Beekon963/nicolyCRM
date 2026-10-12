/**
 * 日報のフォーマット（Phase 4-1）: オーナーだけが作る・直す。管理者は読める（日報を作るため）。
 * マイページの報告では、その現場の取引先で使う書式（スタッフにも出すもの）と、本人の名前・取引先の名前だけが返る。
 */
import { afterAll, describe, expect, it } from "vitest";
import { REPORT_PRESETS } from "@/lib/report-format";
import { asRole, closePool, getPool, tryQuery } from "./helpers";

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

  it("稼働開始の報告の文面（start_block）もマイページに返る", async () => {
    await asRole("anon", async (c) => {
      await c.query("reset role");
      const staff = (await c.query(`select id, mypage_token as token from public.staff where status = 'active' order by id limit 1`)).rows[0];
      const client = (await c.query(`select id from public.companies where kind = 'client' order by id limit 1`)).rows[0];
      const role = (await c.query(`select id from public.roles where name = 'クローザー'`)).rows[0];
      const venue = (await c.query(`select id from public.venues limit 1`)).rows[0];
      const ev = (await c.query(`insert into public.events (client_id, venue_id, date) values ($1, $2, public.jst_today()) returning id`, [client.id, venue.id])).rows[0];
      const a = (await c.query(`insert into public.assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed') returning id`, [ev.id, staff.id, role.id])).rows[0];
      await c.query(`insert into public.report_formats (name, company_id, for_staff, event_block, start_block) values ('稼働開始つき', $1, true, '{会場}', E'{会場}\\n稼働します')`, [client.id]);
      await c.query("set local role anon");
      const got = (await c.query(`select public.mypage_report_get($1, $2) as r`, [staff.token, a.id])).rows[0].r;
      const f = got.formats.find((x: { name: string }) => x.name === "稼働開始つき");
      expect(f.start_block).toBe("{会場}\n稼働します");
    });
  });

  it("最初に入れておいた仮の「NICOLY用」は、いただいた NICOLY フォーマット（見本と同じ文）になっている", async () => {
    const nicoly = REPORT_PRESETS.find((p) => p.key === "nicoly")!.blocks;
    const row = (await getPool().query(`select header, event_block, person_block, footer from public.report_formats where name = 'NICOLY用'`)).rows[0];
    expect(row).toEqual({ header: nicoly.header, event_block: nicoly.eventBlock, person_block: nicoly.personBlock, footer: nicoly.footer });
  });
});
