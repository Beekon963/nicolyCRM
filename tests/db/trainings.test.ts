/**
 * 研修の予約（Phase 4-3）: 予約用リンクの鍵がないと何も見えない。定員を超えて予約できない。
 * 予約した人は控えの鍵で自分の予約だけ見られ、キャンセルできる。ほかの人の名前・連絡先は返さない。
 * 枠と予約はオーナー・管理者が読み書きできる（金額は扱わない）。
 */
import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { asRole, closePool, tryQuery } from "./helpers";

afterAll(closePool);

const LINK = "t".repeat(43);

/** postgres として予約用リンクと枠を作ってから、anon に切り替える */
async function setup(c: pg.PoolClient, opts: { capacity?: number; startsIn?: string; active?: boolean } = {}) {
  await c.query("reset role");
  await c.query(`insert into public.share_links (kind, token, is_active) values ('training', $1, $2)
                 on conflict (kind) do update set token = excluded.token, is_active = excluded.is_active`, [LINK, opts.active ?? true]);
  const slot = (
    await c.query(
      `insert into public.training_slots (title, starts_at, ends_at, capacity, meeting_url)
       values ('テスト研修', now() + $1::interval, now() + $1::interval + interval '1 hour', $2, 'https://example.com/meet') returning id`,
      [opts.startsIn ?? "2 days", opts.capacity ?? 1],
    )
  ).rows[0].id as string;
  await c.query("set local role anon");
  return slot;
}

const book = async (c: pg.PoolClient, slot: string, name: string, token = LINK) =>
  (await c.query(`select public.training_public_book($1, $2, $3, '090-0000-0000', '') as r`, [token, slot, name])).rows[0].r;

describe("研修の予約（ログインなし）", () => {
  it("使えない鍵・止めたリンクでは枠が見えない", async () => {
    await asRole("anon", async (c) => {
      expect((await c.query(`select public.training_public_slots('x') as r`)).rows[0].r).toEqual({ error: "invalid_token" });
      expect((await c.query(`select public.training_public_slots(repeat('a', 43)) as r`)).rows[0].r).toEqual({ error: "invalid_token" });
      await setup(c, { active: false });
      expect((await c.query(`select public.training_public_slots($1) as r`, [LINK])).rows[0].r).toEqual({ error: "invalid_token" });
    });
  });

  it("枠は見えるが、予約した人の名前・連絡先は返さない。1時間を切った枠は出さない", async () => {
    await asRole("anon", async (c) => {
      const slot = await setup(c, { capacity: 2 });
      await c.query("reset role");
      const soon = (await c.query(`insert into public.training_slots (starts_at, ends_at) values (now() + interval '30 minutes', now() + interval '90 minutes') returning id`)).rows[0].id;
      await c.query("set local role anon");
      expect((await book(c, slot, "予約 一郎")).ok).toBe(true);
      const r = (await c.query(`select public.training_public_slots($1) as r`, [LINK])).rows[0].r;
      const mine = r.slots.find((s: { id: string }) => s.id === slot);
      expect(mine.left).toBe(1);
      expect(r.slots.some((s: { id: string }) => s.id === soon)).toBe(false);
      expect(JSON.stringify(r)).not.toContain("予約 一郎");
      expect(JSON.stringify(r)).not.toContain("090-");
      expect(JSON.stringify(r)).not.toContain("example.com/meet");
    });
  });

  it("定員を超えて予約できない。始まる1時間前を切った枠・止めた枠は予約できない", async () => {
    await asRole("anon", async (c) => {
      const slot = await setup(c, { capacity: 1 });
      expect((await book(c, slot, "一人目")).ok).toBe(true);
      expect(await book(c, slot, "二人目")).toEqual({ error: "full" });
      await c.query("reset role");
      const soon = (await c.query(`insert into public.training_slots (starts_at, ends_at) values (now() + interval '30 minutes', now() + interval '90 minutes') returning id`)).rows[0].id;
      const stopped = (await c.query(`insert into public.training_slots (starts_at, ends_at, is_active) values (now() + interval '3 days', now() + interval '3 days 1 hour', false) returning id`)).rows[0].id;
      await c.query("set local role anon");
      expect(await book(c, soon, "直前")).toEqual({ error: "closed" });
      expect(await book(c, stopped, "止めた枠")).toEqual({ error: "closed" });
      expect(await book(c, slot, "鍵なし", "y".repeat(43))).toEqual({ error: "invalid_token" });
      expect(await book(c, slot, "   ")).toEqual({ error: "invalid_input" });
    });
  });

  it("控えの鍵で自分の予約だけ見られ、キャンセルできる。キャンセルすると枠が空く。リンクを止めても控えは見られる", async () => {
    await asRole("anon", async (c) => {
      const slot = await setup(c, { capacity: 1 });
      const b = await book(c, slot, "控え 花子");
      const got = (await c.query(`select public.training_public_booking($1) as r`, [b.cancel_token])).rows[0].r;
      expect(got).toMatchObject({ name: "控え 花子", title: "テスト研修", meeting_url: "https://example.com/meet", cancelled: false, can_cancel: true });
      expect(got.contact).toBeUndefined();
      expect((await c.query(`select public.training_public_booking($1) as r`, ["z".repeat(43)])).rows[0].r).toEqual({ error: "not_found" });

      await c.query("reset role");
      await c.query(`update public.share_links set is_active = false where kind = 'training'`);
      await c.query("set local role anon");
      expect((await c.query(`select public.training_public_booking($1) as r`, [b.cancel_token])).rows[0].r.name).toBe("控え 花子");

      expect((await c.query(`select public.training_public_cancel($1) as r`, [b.cancel_token])).rows[0].r.ok).toBe(true);
      expect((await c.query(`select public.training_public_cancel($1) as r`, [b.cancel_token])).rows[0].r).toEqual({ error: "cannot_cancel" });
      expect((await c.query(`select public.training_public_booking($1) as r`, [b.cancel_token])).rows[0].r.cancelled).toBe(true);

      await c.query("reset role");
      await c.query(`update public.share_links set is_active = true where kind = 'training'`);
      await c.query("set local role anon");
      expect((await book(c, slot, "次の人")).ok).toBe(true);
    });
  });

  it("anon はテーブルを直接読めない・書けない", async () => {
    await asRole("anon", async (c) => {
      for (const t of ["training_slots", "training_bookings"]) expect((await tryQuery(c, `select * from public.${t} limit 1`)).ok, t).toBe(false);
      expect((await tryQuery(c, `insert into public.training_bookings (slot_id, name) values (gen_random_uuid(), 'x')`)).ok).toBe(false);
    });
  });
});

describe("研修の枠と予約（ログインした人）", () => {
  it("オーナーも管理者も枠を作り、予約を入れ、取り消せる", async () => {
    for (const role of ["owner", "manager"] as const) {
      await asRole(role, async (c) => {
        const slot = (await c.query(`insert into public.training_slots (starts_at, ends_at, capacity) values (now() + interval '1 day', now() + interval '25 hours', 2) returning id`)).rows[0].id;
        const b = (await c.query(`insert into public.training_bookings (slot_id, name, source) values ($1, '電話の人', 'admin') returning id, cancel_token`, [slot])).rows[0];
        expect(b.cancel_token.length).toBeGreaterThanOrEqual(40);
        const upd = await c.query(`update public.training_bookings set cancelled_at = now() where id = $1 returning id`, [b.id]);
        expect(upd.rowCount, role).toBe(1);
      });
    }
  });

  it("参加の URL は http(s) だけ", async () => {
    await asRole("owner", async (c) => {
      const bad = await tryQuery(c, `insert into public.training_slots (starts_at, ends_at, meeting_url) values (now() + interval '1 day', now() + interval '25 hours', 'javascript:alert(1)')`);
      expect(bad.ok).toBe(false);
      const good = await tryQuery(c, `insert into public.training_slots (starts_at, ends_at, meeting_url) values (now() + interval '1 day', now() + interval '25 hours', 'https://meet.google.com/abc-defg-hij')`);
      expect(good.ok).toBe(true);
    });
  });

  it("管理者は予約用リンクを作り直せない（オーナーだけ）", async () => {
    await asRole("manager", async (c) => {
      const r = await tryQuery(c, `insert into public.share_links (kind, token) values ('training', repeat('m', 43))`);
      expect(r.ok).toBe(false);
    });
  });
});
