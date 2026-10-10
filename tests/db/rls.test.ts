/**
 * 権限（RLS）のテスト。docs/design/security.md の「自動テストで確かめること」
 *
 * ★ 金額系テーブルを追加・変更したら money-tables.ts の MONEY_TABLES に必ず足すこと。
 */
import { afterAll, describe, expect, it } from "vitest";
import { SEED_USERS } from "../../scripts/seed/constants.mts";
import { asAdmin, asRole, closePool, tryQuery } from "./helpers";
import { MONEY_TABLES } from "./money-tables";


/** 金額や口座を表す列名（管理者が読めるテーブルにあってはいけない） */
const MONEY_COLUMN = /(rate|amount|total|price|fee|revenue|profit|salary|bank|account_number|account_holder|invoice_number|withholding)/;
/** 例外: 交通費・経費の申請額は管理者も見て承認する（要件 §3） */
const ALLOWED_MONEY_COLUMNS = new Set(["expenses.amount"]);

afterAll(closePool);

describe("RLS の付け忘れがない", () => {
  it("public スキーマの全テーブルで RLS が有効", async () => {
    const rows = await asAdmin(async (c) =>
      (
        await c.query(`
          select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)
      ).rows,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("ビューはすべて security_invoker（RLS をすり抜けない）", async () => {
    const rows = await asAdmin(async (c) =>
      (
        await c.query(`
          select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'v'
             and not coalesce(c.reloptions @> array['security_invoker=true'], false)`)
      ).rows,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("管理者が読めるテーブルに金額・口座の列がない", async () => {
    const rows = await asAdmin(async (c) =>
      (
        await c.query(`
          select table_name, column_name from information_schema.columns
           where table_schema = 'public'
             and table_name in (select tablename from pg_tables where schemaname = 'public')`)
      ).rows as { table_name: string; column_name: string }[],
    );
    const leaks = rows
      .filter((r) => !(MONEY_TABLES as readonly string[]).includes(r.table_name))
      .filter((r) => MONEY_COLUMN.test(r.column_name))
      .map((r) => `${r.table_name}.${r.column_name}`)
      .filter((col) => !ALLOWED_MONEY_COLUMNS.has(col));
    expect(leaks).toEqual([]);
  });
});

describe("ログインしていない利用者（マイページ以外）", () => {
  it("どのテーブルも読めない", async () => {
    for (const t of ["staff", "events", "assignments", "staff_private", "app_users", "settings"]) {
      const r = await asRole("anon", (c) => tryQuery(c, `select * from public.${t} limit 1`));
      expect(r.ok, t).toBe(false);
    }
  });

  it("マイページ用・見るだけリンク用以外の関数を実行できない", async () => {
    const rows = await asAdmin(async (c) =>
      (
        await c.query(`
          select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
           order by 1`)
      ).rows.map((r) => r.proname as string),
    );
    expect(rows.filter((name) => !name.startsWith("mypage_") && name !== "share_board")).toEqual([]);
  });
});

describe("★ 金額系テーブル", () => {
  it.each(MONEY_TABLES)("%s: 管理者は 0 件", async (table) => {
    const r = await asRole("manager", (c) => c.query(`select * from public.${table}`));
    expect(r.rowCount).toBe(0);
  });

  it.each(MONEY_TABLES)("%s: 無効化した管理者も 0 件", async (table) => {
    const r = await asRole("inactive", (c) => c.query(`select * from public.${table}`));
    expect(r.rowCount).toBe(0);
  });

  it("オーナーは読める（ダミーデータが入っているテーブル）", async () => {
    for (const t of ["staff_private", "rank_rates", "client_rates", "incentive_rates", "assignment_private", "payment_adjustments", "owner_settings"]) {
      const r = await asRole("owner", (c) => c.query(`select * from public.${t}`));
      expect(r.rowCount, t).toBeGreaterThan(0);
    }
  });

  it("管理者は書き込めない", async () => {
    await asRole("manager", async (c) => {
      const staff = (await c.query(`select id from public.staff limit 1`)).rows[0];
      const ins = await tryQuery(c, `insert into public.payment_adjustments (staff_id, month, amount, reason) values ($1, '2026-10-01', 100, 'test')`, [staff.id]);
      expect(ins.ok).toBe(false);
      const upd = await tryQuery(c, `update public.staff_private set base_daily_rate = 1 returning staff_id`);
      expect(upd.ok && upd.rowCount).toBe(0);
      const rank = await tryQuery(c, `insert into public.rank_rates (rank_id, base_daily_rate) select id, 1 from public.ranks limit 1`);
      expect(rank.ok).toBe(false);
    });
  });

  it("管理者は変更履歴を直接読めないが、実績の履歴は専用関数で読める", async () => {
    await asRole("owner", async (c) => {
      const a = (await c.query(`select assignment_id from public.report_items where confirmed_count is null limit 1`)).rows[0];
      await c.query(`update public.report_items set reported_count = coalesce(reported_count, 0) + 1 where assignment_id = $1`, [a.assignment_id]);
      // 同じトランザクションのまま管理者に切り替える
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: SEED_USERS.manager.id, role: "authenticated" }),
      ]);
      expect((await c.query(`select * from public.audit_logs`)).rowCount).toBe(0);
      const h = await c.query(`select * from public.report_history($1)`, [a.assignment_id]);
      expect(h.rowCount).toBeGreaterThan(0);
    });
  });
});

describe("オーナー・管理者の基本の権限", () => {
  it("管理者は現場・スタッフなどを読み書きできる", async () => {
    await asRole("manager", async (c) => {
      expect((await c.query(`select * from public.staff`)).rowCount).toBeGreaterThanOrEqual(40);
      expect((await c.query(`select * from public.event_overview`)).rowCount).toBeGreaterThan(50);
      const r = await tryQuery(c, `update public.staff set memo = 'テスト' where id = (select id from public.staff limit 1) returning id`);
      expect(r.ok && r.rowCount).toBe(1);
    });
  });

  it("無効化した管理者は何も読めない", async () => {
    await asRole("inactive", async (c) => {
      expect((await c.query(`select * from public.staff`)).rowCount).toBe(0);
      expect((await c.query(`select * from public.events`)).rowCount).toBe(0);
      expect((await c.query(`select * from public.app_users`)).rowCount).toBe(0);
    });
  });

  it("設定・利用者の変更はオーナーだけ", async () => {
    await asRole("manager", async (c) => {
      const s = await tryQuery(c, `update public.settings set value = '15' where key = 'availability_deadline_day' returning key`);
      expect(s.ok && s.rowCount).toBe(0);
      const u = await tryQuery(c, `update public.app_users set role = 'owner' where id = $1 returning id`, [SEED_USERS.manager.id]);
      expect(u.ok && u.rowCount).toBe(0);
      const m = await tryQuery(c, `insert into public.roles (name) values ('テスト役割')`);
      expect(m.ok).toBe(false);
    });
    await asRole("owner", async (c) => {
      const s = await tryQuery(c, `update public.settings set value = '15' where key = 'availability_deadline_day' returning key`);
      expect(s.ok && s.rowCount).toBe(1);
    });
  });
});

describe("トリガー", () => {
  it("アサインの状態を変えると変更履歴に残る", async () => {
    await asRole("manager", async (c) => {
      const a = (await c.query(`select id from public.assignments where status = 'offered' limit 1`)).rows[0];
      await c.query(`update public.assignments set status = 'declined' where id = $1`, [a.id]);
      // 変更履歴はオーナーしか読めないので postgres として確認
      await c.query("reset role");
      const log = await c.query(`select * from public.audit_logs where table_name = 'assignments' and row_id = $1`, [a.id]);
      expect(log.rowCount).toBe(1);
      expect(log.rows[0].user_id).toBe(SEED_USERS.manager.id);
      expect(log.rows[0].changed_fields).toContain("status");
      expect(log.rows[0].before.status).toBe("offered");
      expect(log.rows[0].after.status).toBe("declined");
    });
  });

  it("キャンセルにすると稼働履歴メモが自動で入る", async () => {
    await asRole("manager", async (c) => {
      const a = (
        await c.query(`select a.id, a.staff_id from public.assignments a join public.events e on e.id = a.event_id
                        where a.status = 'confirmed' and e.date >= public.jst_today() limit 1`)
      ).rows[0];
      await c.query(`update public.assignments set status = 'cancelled', cancel_reason_code = 'no_contact', cancel_reason = '電話に出ない' where id = $1`, [a.id]);
      const note = await c.query(`select * from public.staff_notes where assignment_id = $1`, [a.id]);
      expect(note.rowCount).toBe(1);
      expect(note.rows[0].kind).toBe("last_minute_cancel");
      expect(note.rows[0].is_auto).toBe(true);
      expect(note.rows[0].memo).toContain("電話に出ない");
    });
  });

  it("締めた月は実績を変更できず、ロック解除すると変更できる", async () => {
    await asRole("owner", async (c) => {
      const ri = (
        await c.query(`select ri.assignment_id, ri.item_id, public.month_start(e.date) as month
                         from public.report_items ri join public.assignments a on a.id = ri.assignment_id
                         join public.events e on e.id = a.event_id where ri.confirmed_count is null limit 1`)
      ).rows[0];
      await c.query(`insert into public.monthly_closings (month, status, closed_at) values ($1, 'closed', now())`, [ri.month]);
      const locked = await tryQuery(c, `update public.report_items set reported_count = 9 where assignment_id = $1 and item_id = $2`, [ri.assignment_id, ri.item_id]);
      expect(locked.ok).toBe(false);
      if (!locked.ok) expect(locked.error).toContain("締め済み");
      await c.query(`update public.monthly_closings set status = 'unlocked' where month = $1`, [ri.month]);
      const unlocked = await tryQuery(c, `update public.report_items set reported_count = 9 where assignment_id = $1 and item_id = $2`, [ri.assignment_id, ri.item_id]);
      expect(unlocked.ok).toBe(true);
    });
  });

  it("速報と確定が違うときは理由が必須", async () => {
    await asRole("manager", async (c) => {
      const ri = (await c.query(`select assignment_id, item_id from public.report_items where reported_count > 0 limit 1`)).rows[0];
      const bad = await tryQuery(c, `update public.report_items set confirmed_count = reported_count + 1, diff_reason = null where assignment_id = $1 and item_id = $2`, [ri.assignment_id, ri.item_id]);
      expect(bad.ok).toBe(false);
      const good = await tryQuery(c, `update public.report_items set confirmed_count = reported_count + 1, diff_reason = 'input_error' where assignment_id = $1 and item_id = $2`, [ri.assignment_id, ri.item_id]);
      expect(good.ok).toBe(true);
    });
  });

  it("現場の取引先に協力会社は選べない", async () => {
    await asRole("manager", async (c) => {
      const r = await tryQuery(
        c,
        `insert into public.events (client_id, venue_id, date)
         values ((select id from public.companies where kind = 'partner' limit 1), (select id from public.venues limit 1), '2026-12-01')`,
      );
      expect(r.ok).toBe(false);
    });
  });
});

describe("候補一覧の並び順（要件 §4.3）", () => {
  it("○ → △ → 未提出 → ×・NG・ダブルブッキング の順に並ぶ", async () => {
    await asRole("manager", async (c) => {
      const ev = (await c.query(`select id from public.events where date >= public.jst_today() order by date limit 1`)).rows[0];
      const rows = (await c.query(`select * from public.event_candidates($1)`, [ev.id])).rows;
      expect(rows.length).toBeGreaterThan(0);
      const groups = rows.map((r) => r.sort_group as number);
      expect([...groups].sort((a, b) => a - b)).toEqual(groups);
      for (const r of rows) {
        const warn = r.availability === "ng" || r.ng_venue || r.ng_client || r.double_booking;
        if (warn) expect(r.sort_group).toBe(3);
        else if (r.availability === "ok") expect(r.sort_group).toBe(0);
        else if (r.availability === "maybe") expect(r.sort_group).toBe(1);
        else expect(r.sort_group).toBe(2);
      }
    });
  });

  it("同日に別現場がある人はダブルブッキングになる", async () => {
    await asRole("manager", async (c) => {
      const pair = (
        await c.query(`select a.staff_id, e2.id as other_event
                         from public.assignments a join public.events e on e.id = a.event_id
                         join public.events e2 on e2.date = e.date and e2.id <> e.id
                        where a.status = 'confirmed' and e.cancelled_at is null limit 1`)
      ).rows[0];
      const rows = (await c.query(`select * from public.event_candidates($1) where staff_id = $2`, [pair.other_event, pair.staff_id])).rows;
      if (rows.length) {
        expect(rows[0].double_booking).toBe(true);
        expect(rows[0].sort_group).toBe(3);
      }
    });
  });
});

describe("日本時間（受け入れテスト: 0時前後で「今日」「明日」がずれない）", () => {
  it("DB の「今日」は日本時間で求めている（UTC 14:59:59 は当日、15:00:00 は翌日）", async () => {
    const r = await asAdmin(async (c) =>
      (
        await c.query(`select
          to_char(('2026-10-06 14:59:59+00'::timestamptz at time zone 'Asia/Tokyo')::date, 'YYYY-MM-DD') as before_midnight,
          to_char(('2026-10-06 15:00:00+00'::timestamptz at time zone 'Asia/Tokyo')::date, 'YYYY-MM-DD') as after_midnight,
          public.jst_today() = (now() at time zone 'Asia/Tokyo')::date as same_rule,
          current_setting('TimeZone') as db_tz`)
      ).rows[0],
    );
    expect(r.before_midnight).toBe("2026-10-06");
    expect(r.after_midnight).toBe("2026-10-07");
    expect(r.same_rule).toBe(true);
    // DB 自体は UTC で動いている（だから jst_today() を使う）
    expect(r.db_tz).toBe("UTC");
  });
});
