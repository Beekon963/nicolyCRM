/**
 * Phase 8: 言いかえ表とまとめた報告。
 * - 言いかえ表（item_aliases）: 足す・消すのはオーナー。管理者は読める（変換に使う）。ログインしていない人は読めない
 * - マイページの報告: 同じ現場の全員（名前・役割・件数・コメント）と言いかえ表が返る。
 *   電話番号・マイページの鍵・金額は返さない。ほかの取引先の言いかえは返さない
 */
import { afterAll, describe, expect, it } from "vitest";
import { SENTINELS } from "../../scripts/seed/constants.mts";
import { asRole, closePool, tryQuery } from "./helpers";

afterAll(closePool);

describe("言いかえ表", () => {
  it("オーナーは足せる・消せる。管理者は読めるが足せない・直せない・消せない。ログインしていない人は読めない", async () => {
    await asRole("owner", async (c) => {
      const item = (await c.query(`select id from public.items limit 1`)).rows[0];
      const r = await tryQuery(c, `insert into public.item_aliases (alias, item_id) values ('テスト書き方', $1) returning id`, [item.id]);
      expect(r.ok).toBe(true);
      // 同じ書き方は2つ作れない（大文字・小文字、前後の空白は区別しない）
      expect((await tryQuery(c, `insert into public.item_aliases (alias, item_id) values (' テスト書き方 ', $1)`, [item.id])).ok).toBe(false);
      const del = await tryQuery(c, `delete from public.item_aliases where alias = 'テスト書き方' returning id`);
      expect(del.ok && del.rowCount).toBe(1);
    });
    await asRole("manager", async (c) => {
      const item = (await c.query(`select id from public.items limit 1`)).rows[0];
      expect((await tryQuery(c, `select * from public.item_aliases`)).ok).toBe(true);
      expect((await tryQuery(c, `insert into public.item_aliases (alias, item_id) values ('管理者', $1)`, [item.id])).ok).toBe(false);
      const upd = await tryQuery(c, `update public.item_aliases set alias = 'x' returning id`);
      expect(upd.ok && upd.rowCount > 0).toBe(false);
      const del = await tryQuery(c, `delete from public.item_aliases returning id`);
      expect(del.ok && del.rowCount > 0).toBe(false);
    });
    await asRole("anon", async (c) => {
      expect((await tryQuery(c, `select * from public.item_aliases`)).ok).toBe(false);
    });
  });
});

describe("マイページの報告: 同じ現場の全員と言いかえ表", () => {
  it("同じ現場の確定した全員の名前・件数・コメントが返る。電話番号・鍵・金額は返さない。ほかの取引先の言いかえは返さない", async () => {
    await asRole("anon", async (c) => {
      await c.query("reset role");
      const staff = (await c.query(`select id, name, phone, mypage_token as token from public.staff where status = 'active' order by id limit 3`)).rows;
      const clients = (await c.query(`select id from public.companies where kind = 'client' order by id limit 2`)).rows;
      const role = (await c.query(`select id from public.roles where name = 'クローザー'`)).rows[0];
      const venue = (await c.query(`select id from public.venues limit 1`)).rows[0];
      const items = (await c.query(`select id, name from public.items where is_active order by sort_order limit 2`)).rows;
      const ev = (await c.query(`insert into public.events (client_id, venue_id, date) values ($1, $2, public.jst_today()) returning id`, [clients[0].id, venue.id])).rows[0];
      const mine = (await c.query(`insert into public.assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed') returning id`, [ev.id, staff[0].id, role.id])).rows[0];
      const other = (await c.query(`insert into public.assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed') returning id`, [ev.id, staff[1].id, role.id])).rows[0];
      // 打診中の人は入らない
      await c.query(`insert into public.assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'offered')`, [ev.id, staff[2].id, role.id]);
      await c.query(`insert into public.reports (assignment_id, comment, submitted_at) values ($1, 'となりの人のコメント', now())`, [other.id]);
      await c.query(`insert into public.report_items (assignment_id, item_id, reported_count) values ($1, $2, 3)`, [other.id, items[0].id]);
      await c.query(
        `insert into public.item_aliases (company_id, alias, item_id) values ($1, 'この取引先の書き方', $3), ($2, 'ほかの取引先の書き方', $3), (null, '全部の取引先の書き方', $3)`,
        [clients[0].id, clients[1].id, items[1].id],
      );
      await c.query("set local role anon");
      const got = (await c.query(`select public.mypage_report_get($1, $2) as r`, [staff[0].token, mine.id])).rows[0].r;

      expect(got.coworkers).toHaveLength(2);
      const me = got.coworkers.find((w: { me: boolean }) => w.me);
      const them = got.coworkers.find((w: { me: boolean }) => !w.me);
      expect(me.name).toBe(staff[0].name);
      expect(them).toMatchObject({ name: staff[1].name, submitted: true, comment: "となりの人のコメント", counts: { [items[0].name]: 3 } });
      expect(Object.keys(them).sort()).toEqual(["comment", "counts", "me", "name", "role", "submitted"]);

      const aliases = got.aliases.map((a: { alias: string }) => a.alias);
      expect(aliases).toEqual(expect.arrayContaining(["この取引先の書き方", "全部の取引先の書き方"]));
      expect(aliases).not.toContain("ほかの取引先の書き方");

      // 電話番号・マイページの鍵・金額（ダミーデータの目印）が入っていない
      const json = JSON.stringify(got);
      for (const s of staff) {
        if (s.phone) expect(json).not.toContain(s.phone);
        expect(json).not.toContain(s.token);
      }
      for (const v of Object.values(SENTINELS)) expect(json).not.toContain(String(v));
    });
  });
});
