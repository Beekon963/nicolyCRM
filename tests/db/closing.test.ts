/**
 * 月次締め（Phase 3-4）: 締める → その月は変更できない → ロック解除（理由）→ もう一度締める。
 * 支払済みの状態と支払日は、もう一度締めても残る。オーナーだけができる。
 */
import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { asRole, closePool, tryQuery } from "./helpers";

afterAll(closePool);

async function setup(c: pg.PoolClient) {
  const month = (await c.query(`select to_char(public.month_start(public.jst_today()) - interval '1 month', 'YYYY-MM-DD') as m`)).rows[0].m as string;
  const staff = (await c.query(`select id from public.staff where status = 'active' order by id limit 2`)).rows as { id: string }[];
  const client = (await c.query(`select id from public.companies where kind = 'client' order by id limit 1`)).rows[0] as { id: string };
  // 前の月が締め済みになっていない状態から始める（トランザクションの中なので DB には残らない）
  await c.query(`delete from public.closing_logs where month = $1`, [month]);
  await c.query(`delete from public.monthly_closings where month = $1`, [month]);
  await c.query(`delete from public.payments where month = $1`, [month]);
  await c.query(`delete from public.invoices where month = $1`, [month]);
  const pay = (staffId: string, net: number) => ({
    staff_id: staffId,
    daily_total: net,
    incentive_total: 0,
    adjustment_total: 0,
    expense_total: 0,
    withholding_base: net,
    withholding_amount: 0,
    net_amount: net,
    detail: { id: staffId },
  });
  const inv = { company_id: client.id, subtotal: 100000, tax: 10000, total: 110000, detail: { id: client.id } };
  return { month, staff, client, pay, inv };
}

const close = (c: pg.PoolClient, month: string, payments: unknown[], invoices: unknown[]) =>
  tryQuery(c, `select public.close_month($1, $2, $3, $4) as r`, [month, JSON.stringify({ v: 1 }), JSON.stringify(invoices), JSON.stringify(payments)]);

describe("月次締め", () => {
  it("締めると請求・支払いが保存され、その月の現場・アサインは変更できなくなる", async () => {
    await asRole("owner", async (c) => {
      const { month, staff, inv, pay } = await setup(c);
      const r = await close(c, month, [pay(staff[0].id, 50000), pay(staff[1].id, 30000)], [inv]);
      expect(r.ok).toBe(true);

      const mc = (await c.query(`select status, closed_by from public.monthly_closings where month = $1`, [month])).rows[0];
      expect(mc.status).toBe("closed");
      expect(mc.closed_by).not.toBeNull();
      const pays = (await c.query(`select status, net_amount from public.payments where month = $1 order by net_amount desc`, [month])).rows;
      expect(pays.map((p) => [p.status, p.net_amount])).toEqual([
        ["confirmed", 50000],
        ["confirmed", 30000],
      ]);
      expect((await c.query(`select total from public.invoices where month = $1`, [month])).rows[0].total).toBe(110000);
      expect((await c.query(`select action from public.closing_logs where month = $1`, [month])).rows.map((x) => x.action)).toEqual(["close"]);

      // 締めた月の現場: 変更・追加できない
      const ev = (await c.query(`select id from public.events where public.month_start(date) = $1 limit 1`, [month])).rows[0];
      if (ev) {
        const upd = await tryQuery(c, `update public.events set notes = 'x' where id = $1`, [ev.id]);
        expect(upd.ok).toBe(false);
        if (!upd.ok) expect(upd.error).toContain("締め済み");
      }
      const ins = await tryQuery(c, `insert into public.events (client_id, venue_id, date) values ((select id from public.companies where kind = 'client' limit 1), (select id from public.venues limit 1), $1)`, [month]);
      expect(ins.ok).toBe(false);
      // 締めた月に別の月から現場を移すこともできない
      const later = (await c.query(`select id from public.events where date >= public.jst_today() limit 1`)).rows[0];
      if (later) expect((await tryQuery(c, `update public.events set date = $2 where id = $1`, [later.id, month])).ok).toBe(false);

      // 二重には締められない
      const again = await close(c, month, [], []);
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.error).toContain("すでに締めています");
    });
  });

  it("まだ終わっていない月は締められない", async () => {
    await asRole("owner", async (c) => {
      const r = await tryQuery(c, `select public.close_month(public.jst_today(), '{}', '[]', '[]')`);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("まだ終わっていない");
    });
  });

  it("ロック解除は理由が必須。もう一度締めても支払済みの状態・支払日は残り、金額が変わった人を返す", async () => {
    await asRole("owner", async (c) => {
      const { month, staff, inv, pay } = await setup(c);
      expect((await close(c, month, [pay(staff[0].id, 50000), pay(staff[1].id, 30000)], [inv])).ok).toBe(true);

      // 支払済みにする（1人）
      const paid = await c.query(`select public.set_payments_paid($1, $2, '2026-01-25') as n`, [month, [staff[0].id]]);
      expect(paid.rows[0].n).toBe(1);

      // 理由なしでは解除できない
      const noReason = await tryQuery(c, `select public.unlock_month($1, '  ')`, [month]);
      expect(noReason.ok).toBe(false);
      await c.query(`select public.unlock_month($1, '交通費の承認漏れ')`, [month]);
      expect((await c.query(`select status from public.monthly_closings where month = $1`, [month])).rows[0].status).toBe("unlocked");
      const statuses = (await c.query(`select staff_id, status from public.payments where month = $1`, [month])).rows;
      expect(statuses.find((x) => x.staff_id === staff[0].id)?.status).toBe("paid");
      expect(statuses.find((x) => x.staff_id === staff[1].id)?.status).toBe("unconfirmed");
      // ロック解除中は支払済みにできない
      expect((await tryQuery(c, `select public.set_payments_paid($1, $2, '2026-01-25')`, [month, [staff[1].id]])).ok).toBe(false);

      // もう一度締める（支払済みの人の金額が変わる）
      const r = await close(c, month, [pay(staff[0].id, 52000), pay(staff[1].id, 30000)], [inv]);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.rows[0].r.changed_paid).toEqual([{ staff_id: staff[0].id, before: 50000, after: 52000 }]);
      const after = (await c.query(`select staff_id, status, to_char(paid_on, 'YYYY-MM-DD') as paid_on, net_amount from public.payments where month = $1`, [month])).rows;
      const p0 = after.find((x) => x.staff_id === staff[0].id);
      expect([p0?.status, p0?.paid_on, p0?.net_amount]).toEqual(["paid", "2026-01-25", 52000]);
      expect(after.find((x) => x.staff_id === staff[1].id)?.status).toBe("confirmed");
      const logs = (await c.query(`select action, reason from public.closing_logs where month = $1 order by created_at, action`, [month])).rows;
      expect(logs.map((l) => l.action).sort()).toEqual(["close", "reclose", "unlock"]);
      expect(logs.find((l) => l.action === "unlock")?.reason).toBe("交通費の承認漏れ");

      // 支払済みを取り消す
      expect((await c.query(`select public.set_payments_paid($1, $2, null) as n`, [month, [staff[0].id]])).rows[0].n).toBe(1);
      expect((await c.query(`select status, paid_on from public.payments where month = $1 and staff_id = $2`, [month, staff[0].id])).rows[0]).toEqual({ status: "confirmed", paid_on: null });
    });
  });

  it("管理者は締め・ロック解除・支払済みにできない", async () => {
    await asRole("manager", async (c) => {
      const month = (await c.query(`select public.month_start(public.jst_today()) - interval '1 month' as m`)).rows[0].m;
      for (const q of [
        `select public.close_month($1, '{}', '[]', '[]')`,
        `select public.unlock_month($1, '理由')`,
        `select public.set_payments_paid($1, '{}'::uuid[], '2026-01-25')`,
      ]) {
        const r = await tryQuery(c, q, [month]);
        expect(r.ok, q).toBe(false);
        if (!r.ok) expect(r.error).toContain("オーナーだけ");
      }
    });
  });
});
