/**
 * シートから取り込んだ過去の記録（events.report_required = false）は「未報告」に数えない（Phase 1.5）
 */
import { afterAll, describe, expect, it } from "vitest";
import { asAdmin, closePool } from "./helpers";

afterAll(closePool);

describe("記録のみの現場", () => {
  it("未報告・未確定に数えず、状態は「終了」。マイページの報告一覧にも出ない", async () => {
    await asAdmin(async (c) => {
      const staff = (await c.query(`select id, mypage_token as token from public.staff where status = 'active' order by id limit 1`)).rows[0];
      const role = (await c.query(`select id from public.roles where name = 'クローザー'`)).rows[0];
      const client = (await c.query(`select id from public.companies where kind = 'client' limit 1`)).rows[0];
      const venues = (await c.query(`select id from public.venues order by id limit 2`)).rows;
      const make = async (venueId: string, reportRequired: boolean) => {
        const ev = (
          await c.query(
            `insert into public.events (client_id, venue_id, date, report_required) values ($1, $2, public.jst_today() - 1, $3) returning id`,
            [client.id, venueId, reportRequired],
          )
        ).rows[0];
        await c.query(`insert into public.event_requirements (event_id, role_id, required_count) values ($1, $2, 1)`, [ev.id, role.id]);
        await c.query(`insert into public.assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed')`, [ev.id, staff.id, role.id]);
        return ev.id as string;
      };
      // 同じ人が同じ日に2つ（テスト用。ふだんは同日別現場の警告が出る）
      const normal = await make(venues[0].id, true);
      const recordOnly = await make(venues[1].id, false);

      const ov = (await c.query(`select id, unreported_count, unconfirmed_result_count, status from public.event_overview where id = any($1)`, [[normal, recordOnly]])).rows;
      const byId = Object.fromEntries(ov.map((r) => [r.id, r]));
      expect(byId[normal]).toMatchObject({ unreported_count: 1, unconfirmed_result_count: 1, status: "done" });
      expect(byId[recordOnly]).toMatchObject({ unreported_count: 0, unconfirmed_result_count: 0, status: "done" });

      const reports = (await c.query(`select public.mypage_reports($1) as r`, [staff.token])).rows[0].r;
      const ids = reports.items.map((i: { event: { id: string } }) => i.event.id);
      expect(ids).toContain(normal);
      expect(ids).not.toContain(recordOnly);
    });
  });
});
