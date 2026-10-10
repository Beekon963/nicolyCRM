/**
 * 稼働表の「見るだけリンク」（Phase 1.5）
 */
import { afterAll, describe, expect, it } from "vitest";
import { SENTINELS } from "../../scripts/seed/constants.mts";
import { asAdmin, asRole, closePool } from "./helpers";

afterAll(closePool);

const TOKEN = "t".repeat(48);

describe("見るだけリンクの発行", () => {
  it("リンクの鍵は anon からは読めない。管理者は読めるが、発行・変更はオーナーだけ", async () => {
    await expect(asRole("anon", (c) => c.query(`select token from public.share_links`))).rejects.toThrow(/permission denied/);

    await asRole("manager", async (c) => {
      await expect(c.query(`insert into public.share_links (kind, token) values ('board', $1)`, [TOKEN])).rejects.toThrow(/row-level security/);
    });
    await asRole("owner", async (c) => {
      await c.query(`insert into public.share_links (kind, token) values ('board', $1)`, [TOKEN]);
      expect((await c.query(`update public.share_links set is_active = false where kind = 'board' returning kind`)).rowCount).toBe(1);
    });
  });
});

describe("見るだけリンクで読める内容", () => {
  async function call(token: string, monthOffset = 0) {
    return asAdmin(async (c) => {
      await c.query(`insert into public.share_links (kind, token) values ('board', $1) on conflict (kind) do update set token = excluded.token, is_active = true`, [TOKEN]);
      const m = (await c.query(`select to_char(date_trunc('month', public.jst_today()) + make_interval(months => $1), 'YYYY-MM-DD') as m`, [monthOffset])).rows[0].m;
      await c.query(`set local role anon`);
      const r = await c.query(`select public.share_board($1, $2::date) as r`, [token, m]);
      return r.rows[0].r;
    });
  }

  it("正しい鍵なら、今月の現場・確定した予定・稼働可能日・スタッフが返る", async () => {
    const r = await call(TOKEN);
    expect(r.error).toBeUndefined();
    expect(r.events.length).toBeGreaterThan(0);
    expect(r.staff.length).toBeGreaterThan(0);
    expect(r.assignments.every((a: { status: string }) => a.status === "confirmed")).toBe(true);
    expect(Object.keys(r.staff[0]).sort()).toEqual(["id", "kana", "name", "nearest_station", "rank_name", "rank_order"]);
  });

  it("金額・電話番号・マイページの鍵は返さない", async () => {
    const out = JSON.stringify(await call(TOKEN));
    for (const s of Object.values(SENTINELS)) expect(out).not.toContain(String(s));
    expect(out).not.toMatch(/090-0000-|mypage_token|daily_rate|amount|phone/);
    const tokens = await asAdmin(async (c) => (await c.query(`select mypage_token from public.staff limit 5`)).rows.map((x) => x.mypage_token as string));
    for (const t of tokens) expect(out).not.toContain(t);
  });

  it("違う鍵・止めたリンク・範囲外の月は読めない", async () => {
    expect((await call("x".repeat(48))).error).toBe("invalid_token");
    expect((await call("short")).error).toBe("invalid_token");
    expect((await call(TOKEN, 6)).error).toBe("out_of_range");
    const stopped = await asAdmin(async (c) => {
      await c.query(`insert into public.share_links (kind, token, is_active) values ('board', $1, false) on conflict (kind) do update set token = excluded.token, is_active = false`, [TOKEN]);
      const today = (await c.query(`select to_char(public.jst_today(), 'YYYY-MM-DD') as d`)).rows[0].d;
      await c.query(`set local role anon`);
      return (await c.query(`select public.share_board($1, $2::date) as r`, [TOKEN, today])).rows[0].r;
    });
    expect(stopped.error).toBe("invalid_token");
  });
});

describe("スプレッドシートへの書き出し用", () => {
  it("board_snapshot・board_json は秘密キー（service_role）だけが実行できる（ログインした人・anon は不可）", async () => {
    const can = await asAdmin(async (c) =>
      (
        await c.query(`select r.rolname, p.proname, has_function_privilege(r.rolname, p.oid, 'execute') as ok
                         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                         cross join (values ('anon'), ('authenticated'), ('service_role')) r(rolname)
                        where n.nspname = 'public' and p.proname in ('board_snapshot', 'board_json') order by 2, 1`)
      ).rows,
    );
    expect(can).toEqual([
      { rolname: "anon", proname: "board_json", ok: false },
      { rolname: "authenticated", proname: "board_json", ok: false },
      { rolname: "service_role", proname: "board_json", ok: true },
      { rolname: "anon", proname: "board_snapshot", ok: false },
      { rolname: "authenticated", proname: "board_snapshot", ok: false },
      { rolname: "service_role", proname: "board_snapshot", ok: true },
    ]);
  });

  it("書き出しの記録は管理者が読めるが、書けない", async () => {
    await asRole("manager", async (c) => {
      await c.query(`select * from public.sheet_exports`);
      await expect(c.query(`insert into public.sheet_exports (ok, source) values (true, 'button')`)).rejects.toThrow(/row-level security/);
    });
  });
});
