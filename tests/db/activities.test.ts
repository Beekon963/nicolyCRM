/**
 * 活動の記録と「元に戻す」（Phase 2、要件 §4.8）
 */
import { afterAll, describe, expect, it } from "vitest";
import { asRole, closePool, tryQuery } from "./helpers";

afterAll(closePool);

const RECORD = `select public.record_activity($1, $2, $3, $4, $5, $6, $7, $8) as r`;

async function partner(c: import("pg").PoolClient) {
  return (
    await c.query(
      `insert into public.companies (kind, name, status, next_action_date, next_action)
       values ('partner', 'テスト協力会社（活動）', 'not_contacted', public.jst_today(), '初回の電話') returning id`,
    )
  ).rows[0].id as string;
}

describe("活動の記録", () => {
  it("管理者が記録すると、履歴に残り、会社の次回アクションとステータスが変わる", async () => {
    await asRole("manager", async (c) => {
      const id = await partner(c);
      const { r } = (await c.query(RECORD, [id, "call", "reached", "  担当者と話せた ", null, "2099-01-10", "資料を送る", "contacted"])).rows[0];
      expect(r.before).toEqual({ status: "not_contacted", next_action_date: expect.any(String), next_action: "初回の電話" });

      const co = (await c.query(`select status, next_action_date::text as d, next_action from public.companies where id = $1`, [id])).rows[0];
      expect(co).toEqual({ status: "contacted", d: "2099-01-10", next_action: "資料を送る" });

      const act = (await c.query(`select kind, result, memo, status, user_id is not null as by_user from public.activities where id = $1`, [r.id])).rows[0];
      expect(act).toEqual({ kind: "call", result: "reached", memo: "担当者と話せた", status: "contacted", by_user: true });

      // ステータスの変更は監査ログに残る（CLAUDE.md「営業ステータスの変更は監査ログに」）。監査ログはオーナーしか読めないので管理権限で見る
      await c.query(`reset role`);
      const log = (await c.query(`select changed_fields from public.audit_logs where table_name = 'companies' and row_id = $1 and action = 'update'`, [id])).rows;
      expect(log.some((l) => l.changed_fields.includes("status"))).toBe(true);
    });
  });

  it("ステータスを変えないときは、履歴のステータスは空", async () => {
    await asRole("manager", async (c) => {
      const id = await partner(c);
      const { r } = (await c.query(RECORD, [id, "call", "absent", "", null, null, "", "not_contacted"])).rows[0];
      const act = (await c.query(`select status, next_action_date from public.activities where id = $1`, [r.id])).rows[0];
      expect(act).toEqual({ status: null, next_action_date: null });
      const co = (await c.query(`select next_action_date, next_action from public.companies where id = $1`, [id])).rows[0];
      expect(co).toEqual({ next_action_date: null, next_action: "" });
    });
  });

  it("ほかの会社の担当者は選べない", async () => {
    await asRole("manager", async (c) => {
      const id = await partner(c);
      const other = (await c.query(`select ct.id from public.contacts ct where ct.company_id <> $1 limit 1`, [id])).rows[0];
      const r = await tryQuery(c, RECORD, [id, "call", null, "", other.id, null, "", "not_contacted"]);
      expect(r.ok).toBe(false);
    });
  });

  it("ログインしていない人は記録できない", async () => {
    await asRole("anon", async (c) => {
      const r = await tryQuery(c, RECORD, ["00000000-0000-0000-0000-000000000000", "call", null, "", null, null, "", "contacted"]);
      expect(r.ok).toBe(false);
    });
  });
});

describe("元に戻す", () => {
  it("記録した本人なら、記録を消して会社の値を記録前に戻せる", async () => {
    await asRole("manager", async (c) => {
      const id = await partner(c);
      const before = (await c.query(`select next_action_date::text as d from public.companies where id = $1`, [id])).rows[0].d;
      const { r } = (await c.query(RECORD, [id, "call", "appointment", "", null, "2099-02-01", "商談する", "meeting_set"])).rows[0];
      const undone = (await c.query(`select public.undo_activity($1, $2) as ok`, [r.id, r.before])).rows[0].ok;
      expect(undone).toBe(true);
      expect((await c.query(`select count(*)::int as n from public.activities where id = $1`, [r.id])).rows[0].n).toBe(0);
      const co = (await c.query(`select status, next_action_date::text as d, next_action from public.companies where id = $1`, [id])).rows[0];
      expect(co).toEqual({ status: "not_contacted", d: before, next_action: "初回の電話" });
    });
  });

  it("記録のあとでだれかが会社を直していたら、会社の値は上書きしない", async () => {
    await asRole("manager", async (c) => {
      const id = await partner(c);
      const { r } = (await c.query(RECORD, [id, "call", "reached", "", null, "2099-02-01", "電話", "contacted"])).rows[0];
      await c.query(`update public.companies set next_action_date = '2099-03-01', next_action = '別の予定' where id = $1`, [id]);
      expect((await c.query(`select public.undo_activity($1, $2) as ok`, [r.id, r.before])).rows[0].ok).toBe(true);
      const co = (await c.query(`select next_action_date::text as d, next_action from public.companies where id = $1`, [id])).rows[0];
      expect(co).toEqual({ d: "2099-03-01", next_action: "別の予定" });
    });
  });

  it("ほかの人の記録・時間がたった記録は消せない（履歴として残す）", async () => {
    await asRole("owner", async (c) => {
      const id = await partner(c);
      const { r } = (await c.query(RECORD, [id, "call", null, "", null, null, "", "not_contacted"])).rows[0];
      // 管理者として取り消しを試す
      const managerId = (await c.query(`select id from public.app_users where role = 'manager' and is_active limit 1`)).rows[0].id;
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: managerId, role: "authenticated" })]);
      expect((await c.query(`select public.undo_activity($1, $2) as ok`, [r.id, r.before])).rows[0].ok).toBe(false);
      // 自分の記録でも15分たったら消せない
      const mine = (await c.query(RECORD, [id, "call", null, "", null, null, "", "not_contacted"])).rows[0].r;
      await c.query(`reset role`);
      await c.query(`update public.activities set created_at = now() - interval '16 minutes' where id = $1`, [mine.id]);
      await c.query(`set local role authenticated`);
      expect((await c.query(`select public.undo_activity($1, $2) as ok`, [mine.id, mine.before])).rows[0].ok).toBe(false);
      // 普通の削除もできない
      const del = await tryQuery(c, `delete from public.activities where id = $1`, [mine.id]);
      expect(del.rowCount).toBe(0);
    });
  });
});
