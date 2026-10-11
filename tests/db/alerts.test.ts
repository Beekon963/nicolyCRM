/**
 * Phase 6: 会場の色と、キャンセル・当日不稼働のお知らせ。
 * - 新しい会場には、使われている数が一番少ない色が自動で付く。決まった色のほかは入らない
 * - 見るだけリンクの中身（board_json）に会場の色が入る
 * - 確定 → キャンセル・当日不稼働（今日以降の現場）のときだけ、お知らせが入る（操作した人つき）
 * - お知らせはメンバーだけ読める。どこまで見たかは自分の分だけ読み書きできる
 * - LINE の送る記録に「キャンセル・当日不稼働」の種類を入れられる
 */
import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { SEED_USERS } from "../../scripts/seed/constants.mts";
import { asAdmin, asRole, closePool, tryQuery } from "./helpers";

afterAll(closePool);

const COLORS = ["blue", "navy", "sky", "purple", "lavender", "pink", "brown"];

/** postgres で前準備をしてから、元の利用者に戻す */
async function asPostgres<T>(c: pg.PoolClient, role: "authenticated" | "anon", fn: () => Promise<T>) {
  await c.query("reset role");
  try {
    return await fn();
  } finally {
    await c.query(`set local role ${role}`);
  }
}

/** 日付ずらしで現場を作り、確定のアサインを入れる（postgres で） */
async function confirmedOn(c: pg.PoolClient, days: number) {
  const ev = (
    await c.query(
      `insert into public.events (client_id, venue_id, date)
       select (select id from public.companies where kind = 'client' order by id limit 1), (select id from public.venues order by id limit 1),
              public.jst_today() + $1::int
       returning id`,
      [days],
    )
  ).rows[0];
  const s = (await c.query(`select id from public.staff where status = 'active' order by id limit 1`)).rows[0];
  const r = (await c.query(`select id from public.roles where is_active order by sort_order limit 1`)).rows[0];
  const a = (
    await c.query(`insert into public.assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed') returning id`, [ev.id, s.id, r.id])
  ).rows[0];
  return { eventId: ev.id as string, assignmentId: a.id as string };
}

describe("会場の色", () => {
  it("新しい会場には一番使われていない色が付く。決まった色のほかは入らない", async () => {
    await asRole("manager", async (c) => {
      const counts = await asPostgres(c, "authenticated", async () =>
        Object.fromEntries((await c.query(`select color, count(*)::int as n from public.venues where is_active group by color`)).rows.map((r) => [r.color, r.n])),
      );
      const least = Math.min(...COLORS.map((k) => counts[k] ?? 0));
      const v = (await c.query(`insert into public.venues (name) values ('テスト会場（色）') returning color`)).rows[0];
      expect(COLORS).toContain(v.color);
      expect(counts[v.color] ?? 0).toBe(least);
      const picked = (await c.query(`insert into public.venues (name, color) values ('テスト会場（茶）', 'brown') returning color`)).rows[0];
      expect(picked.color).toBe("brown");
      expect((await tryQuery(c, `insert into public.venues (name, color) values ('テスト会場（赤）', 'red')`)).ok).toBe(false);
    });
  });

  it("見るだけリンクの中身（board_json）に会場の色が入る", async () => {
    await asAdmin(async (c) => {
      const r = (await c.query(`select public.board_json(public.jst_today() - 31, public.jst_today() + 31) as j`)).rows[0].j;
      expect(r.events.length).toBeGreaterThan(0);
      for (const e of r.events) expect(COLORS).toContain(e.venue_color);
    });
  });
});

describe("キャンセル・当日不稼働のお知らせ", () => {
  it("確定 → キャンセル（今日以降の現場）でお知らせが入り、操作した人が残る", async () => {
    await asRole("manager", async (c) => {
      const { assignmentId } = await asPostgres(c, "authenticated", () => confirmedOn(c, 3));
      await c.query(`update public.assignments set status = 'cancelled', cancel_reason_code = 'self' where id = $1`, [assignmentId]);
      const rows = (await c.query(`select status, actor_user_id from public.assignment_alerts where assignment_id = $1`, [assignmentId])).rows;
      expect(rows).toEqual([{ status: "cancelled", actor_user_id: SEED_USERS.manager.id }]);
    });
  });

  it("当日不稼働も入る。過ぎた現場・確定でなかった人（辞退）には入らない", async () => {
    await asRole("manager", async (c) => {
      const today = await asPostgres(c, "authenticated", () => confirmedOn(c, 0));
      const past = await asPostgres(c, "authenticated", () => confirmedOn(c, -2));
      const offered = await asPostgres(c, "authenticated", async () => {
        const x = await confirmedOn(c, 5);
        await c.query(`update public.assignments set status = 'offered' where id = $1`, [x.assignmentId]);
        return x;
      });
      await c.query(`update public.assignments set status = 'no_show', cancel_reason_code = 'no_contact' where id = $1`, [today.assignmentId]);
      await c.query(`update public.assignments set status = 'no_show', cancel_reason_code = 'no_contact' where id = $1`, [past.assignmentId]);
      await c.query(`update public.assignments set status = 'declined' where id = $1`, [offered.assignmentId]);
      const rows = (
        await c.query(`select assignment_id, status from public.assignment_alerts where assignment_id = any($1)`, [[today.assignmentId, past.assignmentId, offered.assignmentId]])
      ).rows;
      expect(rows).toEqual([{ assignment_id: today.assignmentId, status: "no_show" }]);
    });
  });

  it("お知らせはオーナー・管理者が読める。ログインしていない人は読めない。直接は入れられない", async () => {
    await asRole("owner", async (c) => {
      const { assignmentId } = await asPostgres(c, "authenticated", async () => {
        const x = await confirmedOn(c, 2);
        await c.query(`update public.assignments set status = 'cancelled', cancel_reason_code = 'self' where id = $1`, [x.assignmentId]);
        return x;
      });
      expect((await c.query(`select 1 from public.assignment_alerts where assignment_id = $1`, [assignmentId])).rowCount).toBe(1);
      expect((await tryQuery(c, `insert into public.assignment_alerts (assignment_id, status) values ($1, 'cancelled')`, [assignmentId])).ok).toBe(false);
    });
    await asRole("anon", async (c) => {
      const r = await tryQuery(c, `select count(*)::int as n from public.assignment_alerts`);
      expect(!r.ok || r.rows[0].n === 0).toBe(true);
    });
    await asRole("inactive", async (c) => {
      expect((await c.query(`select count(*)::int as n from public.assignment_alerts`)).rows[0].n).toBe(0);
    });
  });

  it("どこまで見たかは、自分の分だけ読み書きできる", async () => {
    await asRole("manager", async (c) => {
      await c.query(`insert into public.alert_seen (user_id, seen_at) values ($1, now()) on conflict (user_id) do update set seen_at = excluded.seen_at`, [SEED_USERS.manager.id]);
      expect((await tryQuery(c, `insert into public.alert_seen (user_id) values ($1)`, [SEED_USERS.owner.id])).ok).toBe(false);
      await asPostgres(c, "authenticated", () =>
        c.query(`insert into public.alert_seen (user_id) values ($1) on conflict (user_id) do nothing`, [SEED_USERS.owner.id]),
      );
      const seen = (await c.query(`select user_id from public.alert_seen`)).rows.map((r) => r.user_id);
      expect(seen).toEqual([SEED_USERS.manager.id]);
    });
  });

  it("LINE の送る記録に「キャンセル・当日不稼働」を入れられる（アサインが必要）", async () => {
    await asAdmin(async (c) => {
      const { assignmentId } = await confirmedOn(c, 4);
      expect((await tryQuery(c, `insert into public.line_outbox (kind, assignment_id) values ('admin_cancel', $1)`, [assignmentId])).ok).toBe(true);
      expect((await tryQuery(c, `insert into public.line_outbox (kind) values ('admin_cancel')`)).ok).toBe(false);
    });
  });
});
