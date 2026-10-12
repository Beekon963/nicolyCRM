/**
 * AI アシスタントの道具（Phase 4-4）を、ローカルの DB に対して実際に動かす。
 * - どの道具もエラーにならずに読める（オーナー・管理者）
 * - ★ 管理者が使うと、金額の道具は使えず、どの道具の結果にも目印の金額が出ない
 * - 確認カード（propose_*）は ID と状態を確かめ、報告・稼働可能日の登録は今までと同じ形で入る
 */
import { createClient as createSupabase, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SEED_PASSWORD, SEED_USERS, SENTINELS } from "../../scripts/seed/constants.mts";
import { closePool, getPool, localSupabase } from "./helpers";

// 道具の中の createClient()（Next.js の cookie を使う）を、ログインした API の利用者に差し替える
let current: SupabaseClient;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current, createAnonClient: () => current }));

const { toolsFor, runTool } = await import("@/lib/ai/tools");
const { executeProposal } = await import("@/lib/ai/proposals");
const { buildSystem } = await import("@/lib/ai/prompt");
const { todayJst, addDays } = await import("@/lib/date");

async function signIn(role: "owner" | "manager") {
  const { API_URL, PUBLISHABLE_KEY } = localSupabase();
  const client = createSupabase(API_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: SEED_USERS[role].email, password: SEED_PASSWORD });
  if (error) throw error;
  return client;
}

const clients: Record<"owner" | "manager", SupabaseClient> = {} as never;
const user = (role: "owner" | "manager") => ({ id: SEED_USERS[role].id, name: role, email: SEED_USERS[role].email, role });
const ctxOf = (role: "owner" | "manager") => {
  current = clients[role];
  return { supabase: clients[role] as never, user: user(role), today: todayJst() };
};
const q = async <T>(sql: string, params: unknown[] = []) => (await getPool().query(sql, params)).rows as T[];

let ids: { staff: string; staffName: string; event: string; client: string; venue: string; role: string; company: string };

beforeAll(async () => {
  clients.owner = await signIn("owner");
  clients.manager = await signIn("manager");
  const [s] = await q<{ id: string; name: string }>(`select id, name from staff where status = 'active' order by id limit 1`);
  const [e] = await q<{ id: string; client_id: string; venue_id: string }>(`select id, client_id, venue_id from events where cancelled_at is null order by date desc limit 1`);
  const [r] = await q<{ id: string }>(`select id from roles where is_active order by sort_order limit 1`);
  const [c] = await q<{ id: string }>(`select id from companies where kind = 'client' limit 1`);
  ids = { staff: s.id, staffName: s.name, event: e.id, client: e.client_id, venue: e.venue_id, role: r.id, company: c.id };
});
afterAll(closePool);

describe("AI の道具（読む）", () => {
  const today = todayJst();
  const inputs = () => ({
    search: { q: ids.staffName.slice(0, 2) },
    list_events: { from: addDays(today, -7), to: addDays(today, 30) },
    get_event: { event_id: ids.event },
    get_staff: { staff_id: ids.staff },
    find_candidates: { event_id: ids.event },
    availability_on: { date: addDays(today, 1) },
    results: { from: addDays(today, -60), to: today },
    daily_report: { date: addDays(today, -1) },
    sales: { due_only: true },
    get_company: { company_id: ids.company },
    money_month: { month: today.slice(0, 7) },
  });

  it.each(["owner", "manager"] as const)("%s: どの道具もエラーにならずに読める（管理者は金額の道具だけ使えない）", async (role) => {
    const ctx = ctxOf(role);
    const tools = toolsFor(ctx.user);
    for (const [name, input] of Object.entries(inputs())) {
      const out = await runTool(ctx, tools, name, input);
      if (role === "manager" && name === "money_month") {
        expect(out).toEqual({ content: "その道具は使えません", isError: true });
        continue;
      }
      expect(out.isError, `${name}: ${out.content}`).toBeFalsy();
      expect(() => JSON.parse(out.content), name).not.toThrow();
    }
  });

  it("★ 管理者が使うと、どの道具の結果にも目印の金額が出ない", async () => {
    const ctx = ctxOf("manager");
    const tools = toolsFor(ctx.user);
    let all = "";
    for (const [name, input] of Object.entries(inputs())) all += (await runTool(ctx, tools, name, input)).content;
    for (const s of Object.values(SENTINELS)) expect(all).not.toContain(String(s));
  });

  it("電話番号・マイページの鍵は返さない", async () => {
    const ctx = ctxOf("owner");
    const tools = toolsFor(ctx.user);
    const [s] = await q<{ phone: string; mypage_token: string }>(`select phone, mypage_token from staff where id = $1`, [ids.staff]);
    const out = (await runTool(ctx, tools, "get_staff", { staff_id: ids.staff })).content + (await runTool(ctx, tools, "search", { q: ids.staffName })).content;
    expect(out).toContain(ids.staffName);
    expect(out).not.toContain(s.mypage_token);
    if (s.phone) expect(out).not.toContain(s.phone);
  });

  it("入力の誤り（期間が長すぎる・知らない ID）は、エラーとして AI に返す", async () => {
    const ctx = ctxOf("owner");
    const tools = toolsFor(ctx.user);
    expect((await runTool(ctx, tools, "list_events", { from: "2026-01-01", to: "2026-12-31" })).content).toContain("62 日まで");
    expect((await runTool(ctx, tools, "get_staff", { staff_id: "00000000-0000-0000-0000-000000000000" })).isError).toBe(true);
    expect((await runTool(ctx, tools, "get_event", { event_id: "abc" })).isError).toBe(true);
  });
});

describe("AI の確認カードと登録", () => {
  it("稼働可能日: カードに名前と日付が出て、登録すると入力元「管理者」で入る", async () => {
    const ctx = ctxOf("manager");
    const date = addDays(todayJst(), 170);
    await q(`delete from availability where staff_id = $1 and date = $2`, [ids.staff, date]);
    try {
      const payload = { entries: [{ staff_id: ids.staff, days: [{ date, status: "maybe" }] }] };
      const out = await runTool(ctx, toolsFor(ctx.user), "propose_availability", payload);
      expect(out.proposal?.rows[0].label).toBe(ids.staffName);
      expect(out.proposal?.rows[0].detail).toContain("△");
      expect(await q(`select 1 from availability where staff_id = $1 and date = $2`, [ids.staff, date])).toHaveLength(0);
      const r = await executeProposal(ctx, "availability", out.proposal!.payload);
      expect(r.ok).toBe(true);
      const [row] = await q<{ status: string; source: string; updated_by: string }>(`select status, source, updated_by from availability where staff_id = $1 and date = $2`, [ids.staff, date]);
      expect(row).toEqual({ status: "maybe", source: "admin", updated_by: SEED_USERS.manager.id });
    } finally {
      await q(`delete from availability where staff_id = $1 and date = $2`, [ids.staff, date]);
    }
  });

  it("実績の報告: まだ報告していない確定の人だけ速報で入る。本人が報告済み・先の現場は入れない", async () => {
    const ctx = ctxOf("manager");
    const today = todayJst();
    const [item] = await q<{ id: string }>(`select id from items where is_active order by sort_order limit 1`);
    const staff = await q<{ id: string }>(`select id from staff where status = 'active' order by id desc limit 3`);
    const [ev] = await q<{ id: string }>(`insert into events (client_id, venue_id, date) values ($1, $2, $3) returning id`, [ids.client, ids.venue, today]);
    const [future] = await q<{ id: string }>(`insert into events (client_id, venue_id, date) values ($1, $2, $3) returning id`, [ids.client, ids.venue, addDays(today, 3)]);
    try {
      const [a1] = await q<{ id: string }>(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed') returning id`, [ev.id, staff[0].id, ids.role]);
      const [a2] = await q<{ id: string }>(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed') returning id`, [ev.id, staff[1].id, ids.role]);
      const [a3] = await q<{ id: string }>(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed') returning id`, [future.id, staff[2].id, ids.role]);
      await q(`insert into reports (assignment_id, submitted_at, source) values ($1, now(), 'self')`, [a2.id]);
      const payload = {
        entries: [a1, a2, a3].map((a) => ({ assignment_id: a.id, counts: [{ item_id: item.id, count: 4 }], comment: "スクショから" })),
      };
      const out = await runTool(ctx, toolsFor(ctx.user), "propose_reports", payload);
      expect(out.proposal?.rows.map((r) => Boolean(r.skip))).toEqual([false, true, true]);
      const r = await executeProposal(ctx, "reports", out.proposal!.payload);
      expect(r.ok, r.ok ? "" : r.message).toBe(true);
      const rows = await q<{ assignment_id: string; reported_count: number; confirmed_count: number | null }>(
        `select assignment_id, reported_count, confirmed_count from report_items where assignment_id = any($1)`,
        [[a1.id, a2.id, a3.id]],
      );
      expect(rows).toEqual([{ assignment_id: a1.id, reported_count: 4, confirmed_count: null }]);
      const [rep] = await q<{ source: string; comment: string; confirmed_at: string | null }>(`select source, comment, confirmed_at from reports where assignment_id = $1`, [a1.id]);
      expect(rep).toEqual({ source: "admin", comment: "スクショから", confirmed_at: null });
    } finally {
      for (const e of [ev.id, future.id]) {
        await q(`delete from report_items where assignment_id in (select id from assignments where event_id = $1)`, [e]);
        await q(`delete from reports where assignment_id in (select id from assignments where event_id = $1)`, [e]);
        await q(`delete from staff_notes where assignment_id in (select id from assignments where event_id = $1)`, [e]);
        await q(`delete from assignments where event_id = $1`, [e]);
        await q(`delete from events where id = $1`, [e]);
      }
    }
  });

  it("現場・打診・営業のカードは、ID を確かめてから出す（違う ID はエラーで返す）", async () => {
    const ctx = ctxOf("manager");
    const tools = toolsFor(ctx.user);
    const bad = "00000000-0000-0000-0000-000000000000";
    const ev = await runTool(ctx, tools, "propose_events", { client_id: ids.client, venue_id: ids.venue, dates: [addDays(todayJst(), 20)], requirements: [{ role_id: ids.role, count: 2 }] });
    expect(ev.proposal?.title).toBe("現場を作る（1件）");
    expect((await runTool(ctx, tools, "propose_events", { client_id: bad, venue_id: ids.venue, dates: [todayJst()], requirements: [{ role_id: ids.role, count: 1 }] })).isError).toBe(true);
    const act = await runTool(ctx, tools, "propose_activity", { company_id: ids.company, kind: "call", result: "reached", memo: "テスト", next_action_date: addDays(todayJst(), 3), next_action: "見積もりを送る" });
    expect(act.proposal?.rows.map((r) => r.label)).toEqual(["会社", "記録", "次回アクション"]);
    expect((await runTool(ctx, tools, "propose_activity", { company_id: bad, kind: "call" })).isError).toBe(true);
    const [free] = await q<{ id: string }>(
      `select s.id from staff s where s.status = 'active' and not exists (select 1 from assignments a where a.staff_id = s.id and a.event_id = $1) limit 1`,
      [ids.event],
    );
    const off = await runTool(ctx, tools, "propose_offers", { event_id: ids.event, role_id: ids.role, staff_ids: [free.id] });
    expect(off.isError, off.content).toBeFalsy();
    expect(off.proposal?.rows).toHaveLength(1);
  });

  it("実績の報告: 取引先が使う獲得項目にない項目は、カードで知らせる（入れるのは止めない）", async () => {
    const ctx = ctxOf("manager");
    const today = todayJst();
    const tag = Math.random().toString(36).slice(2, 6);
    const [client] = await q<{ id: string }>(`insert into companies (kind, name, status) values ('client', $1, 'active') returning id`, [`AI項目${tag}`]);
    const [used, other] = await q<{ id: string; name: string }>(`select id, name from items where is_active order by sort_order limit 2`);
    await q(`insert into company_items (company_id, item_id) values ($1, $2)`, [client.id, used.id]);
    const [ev] = await q<{ id: string }>(`insert into events (client_id, venue_id, date) values ($1, $2, $3) returning id`, [client.id, ids.venue, today]);
    try {
      const [a] = await q<{ id: string }>(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed') returning id`, [ev.id, ids.staff, ids.role]);
      const ok = await runTool(ctx, toolsFor(ctx.user), "propose_reports", { entries: [{ assignment_id: a.id, counts: [{ item_id: used.id, count: 1 }] }] });
      expect(ok.proposal?.warnings).toHaveLength(1);
      const out = await runTool(ctx, toolsFor(ctx.user), "propose_reports", { entries: [{ assignment_id: a.id, counts: [{ item_id: used.id, count: 1 }, { item_id: other.id, count: 2 }] }] });
      expect(out.proposal?.warnings).toContain(`「${other.name}」はAI項目${tag}で使う獲得項目にありません。合っているか確かめてください。`);
      expect(out.proposal?.rows[0].skip).toBeUndefined();
    } finally {
      await q(`delete from assignments where event_id = $1`, [ev.id]);
      await q(`delete from events where id = $1`, [ev.id]);
      await q(`delete from company_items where company_id = $1`, [client.id]);
      await q(`delete from companies where id = $1`, [client.id]);
    }
  });
});

describe("AI への指示", () => {
  it("言いかえ表と、取引先が使う獲得項目が入る（LINE のスクショの書き方を正しい項目にするため）", async () => {
    const ctx = ctxOf("manager");
    const tag = Math.random().toString(36).slice(2, 6);
    const [client] = await q<{ id: string }>(`insert into companies (kind, name, status) values ('client', $1, 'active') returning id`, [`AI言いかえ${tag}`]);
    const [item] = await q<{ id: string; name: string }>(`select id, name from items where is_active order by sort_order limit 1`);
    await q(`insert into company_items (company_id, item_id) values ($1, $2)`, [client.id, item.id]);
    await q(`insert into item_aliases (company_id, alias, item_id) values ($1, $2, $3), (null, $4, $3)`, [client.id, `ほげ${tag}`, item.id, `ふが${tag}`]);
    try {
      const text = (await buildSystem(ctx)).map((b) => b.text).join("\n");
      expect(text).toContain(`- ほげ${tag} → ${item.name}（AI言いかえ${tag}）`);
      expect(text).toContain(`- ふが${tag} → ${item.name}\n`);
      expect(text).toContain(`- AI言いかえ${tag}: ${client.id}（使う獲得項目: ${item.name}）`);
    } finally {
      await q(`delete from item_aliases where alias in ($1, $2)`, [`ほげ${tag}`, `ふが${tag}`]);
      await q(`delete from company_items where company_id = $1`, [client.id]);
      await q(`delete from companies where id = $1`, [client.id]);
    }
  });
});
