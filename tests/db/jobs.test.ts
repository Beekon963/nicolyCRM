/**
 * 案件（Phase 21）: 管理者も案件と候補の段階を扱える。単価（event_group_private）はオーナーだけ（金額のテストは money-tables で）。
 * 段階を変えると stage_changed_at が更新され、変更履歴に残る。案件の取引先は「取引先」の会社だけ。
 */
import { afterAll, describe, expect, it } from "vitest";
import { asRole, closePool } from "./helpers";

afterAll(async () => {
  await closePool();
});

describe("案件と候補の段階", () => {
  it("案件を作り、候補を足して段階を進められる。段階を変えた時刻と変更履歴が残る", async () => {
    // 変更履歴（audit_logs）はオーナーだけが読めるので、オーナーで確かめる
    await asRole("owner", async (c) => {
      const client = (await c.query(`select id from public.companies where kind = 'client' and is_active order by name limit 1`)).rows[0].id;
      const staff = (await c.query(`select id from public.staff where status = 'active' order by kana limit 1`)).rows[0].id;
      const g = (await c.query(`insert into public.event_groups (name, client_id, received_on, hours_note, notes) values ('テスト案件', $1, current_date, '10:00〜18:00', '条件') returning id`, [client])).rows[0].id;
      const cand = (await c.query(`insert into public.group_candidates (group_id, staff_id) values ($1, $2) returning id, stage, stage_changed_at`, [g, staff])).rows[0];
      expect(cand.stage).toBe("candidate");
      await c.query(`select pg_sleep(0.05)`);
      await c.query(`update public.group_candidates set stage = 'sheet_sent' where id = $1`, [cand.id]);
      const after = (await c.query(`select stage, stage_changed_at from public.group_candidates where id = $1`, [cand.id])).rows[0];
      expect(after.stage).toBe("sheet_sent");
      expect(new Date(after.stage_changed_at).getTime()).toBeGreaterThan(new Date(cand.stage_changed_at).getTime());
      // 候補日時だけ変えても段階の時刻は変わらない
      await c.query(`update public.group_candidates set interview_slots = '10/26 20:00〜' where id = $1`, [cand.id]);
      const same = (await c.query(`select stage_changed_at from public.group_candidates where id = $1`, [cand.id])).rows[0];
      expect(new Date(same.stage_changed_at).getTime()).toBe(new Date(after.stage_changed_at).getTime());
      // 変更履歴
      const logs = (await c.query(`select action, changed_fields from public.audit_logs where table_name = 'group_candidates' and row_id = $1 order by id`, [cand.id])).rows;
      expect(logs.map((l) => l.action)).toEqual(["insert", "update", "update"]);
      expect(logs[1].changed_fields).toContain("stage");
      // 同じ人は1つの案件に1回だけ
      await expect(c.query(`insert into public.group_candidates (group_id, staff_id) values ($1, $2)`, [g, staff])).rejects.toThrow();
    });
  });

  it("管理者も案件を作り、候補の段階を進められる（単価以外）", async () => {
    await asRole("manager", async (c) => {
      const client = (await c.query(`select id from public.companies where kind = 'client' and is_active order by name limit 1`)).rows[0].id;
      const staff = (await c.query(`select id from public.staff where status = 'active' order by kana limit 1`)).rows[0].id;
      const g = (await c.query(`insert into public.event_groups (name, client_id) values ('管理者の案件', $1) returning id`, [client])).rows[0].id;
      const cand = (await c.query(`insert into public.group_candidates (group_id, staff_id) values ($1, $2) returning id`, [g, staff])).rows[0];
      await c.query(`update public.group_candidates set stage = 'passed' where id = $1`, [cand.id]);
      expect((await c.query(`select stage from public.group_candidates where id = $1`, [cand.id])).rows[0].stage).toBe("passed");
      await c.query(`update public.event_groups set closed_at = now() where id = $1`, [g]);
    });
  });

  it("案件の取引先は「取引先」の会社だけ（協力会社は入れられない）", async () => {
    await asRole("owner", async (c) => {
      const partner = (await c.query(`select id from public.companies where kind = 'partner' limit 1`)).rows[0]?.id;
      if (!partner) return;
      await expect(c.query(`insert into public.event_groups (name, client_id) values ('だめな案件', $1)`, [partner])).rejects.toThrow(/取引先/);
    });
  });

  it("単価はオーナーだけが読める・入れられる（管理者は 0 件・入れられない）", async () => {
    await asRole("owner", async (c) => {
      const g = (await c.query(`insert into public.event_groups (name) values ('単価の案件') returning id`).then((r) => r.rows[0].id));
      await c.query(`insert into public.event_group_private (group_id, rate, transport_included) values ($1, 20000, true)`, [g]);
      const rows = (await c.query(`select rate from public.event_group_private where group_id = $1`, [g])).rows;
      expect(rows[0].rate).toBe(20000);
    });
    await asRole("manager", async (c) => {
      const g = (await c.query(`insert into public.event_groups (name) values ('管理者の案件') returning id`).then((r) => r.rows[0].id));
      const rows = (await c.query(`select count(*)::int as n from public.event_group_private`)).rows;
      expect(rows[0].n).toBe(0);
      await expect(c.query(`insert into public.event_group_private (group_id, rate) values ($1, 100)`, [g])).rejects.toThrow();
    });
  });
});
