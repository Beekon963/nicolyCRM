/**
 * 会社の経費（Phase 16）。★金額があるので、オーナーだけが読み書きできる。
 * - 管理者・無効化した管理者・ログインしていない人は読めない・書けない（0件）
 * - 消さずに取り消す（消すポリシーはない）。金額の変更は変更履歴に残る
 * - 領収書の写真（receipts バケット）もオーナーだけ
 */
import { afterAll, describe, expect, it } from "vitest";
import { SEED_USERS } from "../../scripts/seed/constants.mts";
import { asAdmin, asRole, closePool, tryQuery } from "./helpers";

afterAll(closePool);

const insert = `insert into public.company_expenses (paid_by, spent_on, vendor, item, category, amount)
  values ($1, '2026-10-01', 'テスト食堂', '飲食代', '飲食', 1680) returning id`;

describe("会社の経費: オーナーだけ", () => {
  it("オーナーは入れて、読んで、直せる。入れた人は自動で入る", async () => {
    await asRole("owner", async (c) => {
      const { id } = (await c.query(insert, [SEED_USERS.owner.id])).rows[0];
      const row = (await c.query(`select created_by, amount from public.company_expenses where id = $1`, [id])).rows[0];
      expect(row).toEqual({ created_by: SEED_USERS.owner.id, amount: 1680 });
      const upd = await c.query(`update public.company_expenses set amount = 1780 where id = $1 returning amount`, [id]);
      expect(upd.rows[0].amount).toBe(1780);
    });
  });

  it("払った人は「まだ決めていない」（空）でも入れられる", async () => {
    await asRole("owner", async (c) => {
      const r = await tryQuery(c, insert, [null]);
      expect(r.ok).toBe(true);
    });
  });

  it.each(["manager", "inactive", "anon"] as const)("%s は読めない・入れられない・直せない", async (actor) => {
    await asRole(actor, async (c) => {
      const read = await tryQuery(c, `select * from public.company_expenses`);
      expect(read.ok ? read.rowCount : 0).toBe(0);
      const ins = await tryQuery(c, insert, [SEED_USERS.owner.id]);
      expect(ins.ok).toBe(false);
      const upd = await tryQuery(c, `update public.company_expenses set amount = 1 returning id`);
      expect(upd.ok ? upd.rowCount : 0).toBe(0);
    });
  });

  it("オーナーでも消せない（取り消しにする）", async () => {
    await asRole("owner", async (c) => {
      const { id } = (await c.query(insert, [SEED_USERS.owner.id])).rows[0];
      const del = await c.query(`delete from public.company_expenses where id = $1`, [id]);
      expect(del.rowCount).toBe(0);
      const v = await c.query(`update public.company_expenses set voided_at = now() where id = $1 returning voided_at`, [id]);
      expect(v.rows[0].voided_at).not.toBeNull();
    });
  });

  it("金額・店のどちらもない、0円・マイナスは入らない", async () => {
    await asRole("owner", async (c) => {
      const none = await tryQuery(c, `insert into public.company_expenses (spent_on, amount) values ('2026-10-01', 100)`);
      expect(none.ok).toBe(false);
      const zero = await tryQuery(c, `insert into public.company_expenses (spent_on, vendor, amount) values ('2026-10-01', 'テスト', 0)`);
      expect(zero.ok).toBe(false);
      const minus = await tryQuery(c, `insert into public.company_expenses (spent_on, vendor, amount) values ('2026-10-01', 'テスト', -500)`);
      expect(minus.ok).toBe(false);
    });
  });

  it("金額の変更は変更履歴に残る（オーナーだけが見る）", async () => {
    await asRole("owner", async (c) => {
      const { id } = (await c.query(insert, [SEED_USERS.owner.id])).rows[0];
      await c.query(`update public.company_expenses set amount = 2000 where id = $1`, [id]);
      const logs = await c.query(`select action, changed_fields from public.audit_logs where table_name = 'company_expenses' and row_id = $1 order by id`, [id]);
      expect(logs.rows.map((r) => r.action)).toEqual(["insert", "update"]);
      expect(logs.rows[1].changed_fields).toEqual(["amount"]);
    });
  });
});

describe("領収書の写真（receipts バケット）", () => {
  const put = `insert into storage.objects (bucket_id, name) values ('receipts', $1) returning id`;

  it("オーナーは入れて読める", async () => {
    await asRole("owner", async (c) => {
      const r = await tryQuery(c, put, ["test/owner.jpg"]);
      expect(r.ok).toBe(true);
      const read = await c.query(`select name from storage.objects where bucket_id = 'receipts' and name = 'test/owner.jpg'`);
      expect(read.rowCount).toBe(1);
    });
  });

  it.each(["manager", "inactive", "anon"] as const)("%s は入れられない・読めない", async (actor) => {
    await asRole(actor, async (c) => {
      const r = await tryQuery(c, put, [`test/${actor}.jpg`]);
      expect(r.ok).toBe(false);
      const read = await tryQuery(c, `select name from storage.objects where bucket_id = 'receipts'`);
      expect(read.ok ? read.rowCount : 0).toBe(0);
    });
  });

  it("バケットは公開していない", async () => {
    await asAdmin(async (c) => {
      const b = await c.query(`select public from storage.buckets where id = 'receipts'`);
      expect(b.rows[0].public).toBe(false);
    });
  });
});
