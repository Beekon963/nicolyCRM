/**
 * Phase 12: ランク制度に合わせる（ランク P・遠方の上乗せの回数・友達紹介・日当は交通費込み・締切10日）
 */
import { afterAll, describe, expect, it } from "vitest";
import { asAdmin, asRole, closePool } from "./helpers";

afterAll(closePool);

describe("ランク制度の初期データ", () => {
  it("ランク P（パートナー）があり、日当は交通費込み・稼働可能日の締切は10日", async () => {
    await asAdmin(async (c) => {
      const p = (await c.query(`select name, description, is_active from public.ranks where name = 'P'`)).rows[0];
      expect(p).toEqual({ name: "P", description: "パートナー", is_active: true });
      const s = (await c.query(`select key, value from public.settings where key in ('transport_included', 'availability_deadline_day') order by key`)).rows;
      expect(s).toEqual([
        { key: "availability_deadline_day", value: 10 },
        { key: "transport_included", value: true },
      ]);
    });
  });
});

describe("遠方の上乗せ・友達紹介", () => {
  it("遠方の回数は管理者も変えられる（0〜10回）", async () => {
    await asRole("manager", async (c) => {
      const a = (await c.query(`select id from public.assignments where status = 'confirmed' and event_id in (select id from public.events where date >= public.jst_today()) limit 1`)).rows[0];
      const r = await c.query(`update public.assignments set travel_steps = 2 where id = $1 returning travel_steps`, [a.id]);
      expect(r.rows[0].travel_steps).toBe(2);
      await expect(c.query(`update public.assignments set travel_steps = 11 where id = $1`, [a.id])).rejects.toThrow();
    });
  });

  it("紹介してくれた人に本人は選べない", async () => {
    await asRole("manager", async (c) => {
      const s = (await c.query(`select id from public.staff limit 1`)).rows[0];
      await expect(c.query(`update public.staff set referred_by = id where id = $1`, [s.id])).rejects.toThrow();
    });
  });

  it("紹介のボーナスはオーナーだけが記録でき、調整額を消すと一緒に消える", async () => {
    await asRole("owner", async (c) => {
      const [a, b] = (await c.query(`select id from public.staff order by id limit 2`)).rows;
      await c.query(`update public.staff set referred_by = $1 where id = $2`, [a.id, b.id]);
      const adj = (
        await c.query(
          `insert into public.payment_adjustments (staff_id, month, amount, reason) values ($1, date_trunc('month', public.jst_today())::date, 15000, '友達紹介のボーナス') returning id`,
          [a.id],
        )
      ).rows[0];
      await c.query(`insert into public.referral_bonuses (referred_staff_id, referrer_staff_id, adjustment_id) values ($1, $2, $3)`, [b.id, a.id, adj.id]);
      // 同じ人の紹介は1回だけ
      await c.query("savepoint s");
      await expect(c.query(`insert into public.referral_bonuses (referred_staff_id, referrer_staff_id, adjustment_id) values ($1, $2, $3)`, [b.id, a.id, adj.id])).rejects.toThrow();
      await c.query("rollback to savepoint s");
      await c.query(`delete from public.payment_adjustments where id = $1`, [adj.id]);
      const left = await c.query(`select 1 from public.referral_bonuses where referred_staff_id = $1`, [b.id]);
      expect(left.rows).toHaveLength(0);
    });
    await asRole("manager", async (c) => {
      await expect(c.query(`insert into public.referral_bonuses (referred_staff_id, referrer_staff_id, adjustment_id) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid())`)).rejects.toThrow();
    });
  });
});

describe("日当は交通費込み（マイページの報告）", () => {
  it("オンのあいだは交通費を受け取らず、報告の画面に知らせる。オフなら今までどおり", async () => {
    await asAdmin(async (c) => {
      const staff = (await c.query(`select id, mypage_token as token from public.staff where status = 'active' order by id limit 1`)).rows[0];
      const role = (await c.query(`select id from public.roles where name = 'クローザー'`)).rows[0];
      const venue = (await c.query(`select id from public.venues limit 1`)).rows[0];
      const client = (await c.query(`select id from public.companies where kind = 'client' limit 1`)).rows[0];
      const ev = (await c.query(`insert into public.events (client_id, venue_id, date) values ($1, $2, public.jst_today()) returning id`, [client.id, venue.id])).rows[0];
      const a = (await c.query(`insert into public.assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed') returning id`, [ev.id, staff.id, role.id])).rows[0];
      const save = (transport: number, other: number) =>
        c.query(`select public.mypage_report_save($1, $2, '[]', '', $3, '大宮〜浦和', $4, '駐車場') as r`, [staff.token, a.id, transport, other]);
      const get = async () => (await c.query(`select public.mypage_report_get($1, $2) as r`, [staff.token, a.id])).rows[0].r;

      expect((await save(640, 300)).rows[0].r).toEqual({ ok: true });
      let got = await get();
      expect(got.transport_included).toBe(true);
      expect(Object.keys(got.expenses)).toEqual(["other"]);

      await c.query(`update public.settings set value = 'false' where key = 'transport_included'`);
      expect((await save(640, 300)).rows[0].r).toEqual({ ok: true });
      got = await get();
      expect(got.transport_included).toBe(false);
      expect(got.expenses.transport).toMatchObject({ amount: 640, status: "pending" });
    });
  });
});
