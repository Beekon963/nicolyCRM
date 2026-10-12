/**
 * Phase 12: 日当はランクで決まる・遠方の上乗せ・友達紹介。お金の計算に読み込む材料を確かめる
 * （計算そのものは src/lib/money の単体テスト）
 */
import { createClient as createSupabase, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SEED_PASSWORD, SEED_USERS } from "../../scripts/seed/constants.mts";
import { closePool, getPool, localSupabase } from "./helpers";

let current: SupabaseClient;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current, createAnonClient: () => current }));
const { loadMoneyInput, getMoneySettings } = await import("@/lib/data/money");
const { getReferralBonusTargets } = await import("@/lib/data/referrals");

const q = async <T>(sql: string, params: unknown[] = []) => (await getPool().query(sql, params)).rows as T[];
const month = "2025-02";
let ids = { event: "", rankOnly: "", personal: "", newcomer: "", events: [] as string[] };
let saved: { key: string; value: unknown }[] = [];

beforeAll(async () => {
  const { API_URL, PUBLISHABLE_KEY } = localSupabase();
  current = createSupabase(API_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { error } = await current.auth.signInWithPassword({ email: SEED_USERS.owner.email, password: SEED_PASSWORD });
  if (error) throw error;
  saved = await q(`select key, value from owner_settings where key in ('travel_allowance', 'referral_bonus')`);
  await q(`insert into owner_settings (key, value) values ('travel_allowance', '{"per_step": 1000}'), ('referral_bonus', '{"amount": 15000, "after": 2}')
           on conflict (key) do update set value = excluded.value`);
  const [client] = await q<{ id: string }>(`select id from companies where kind = 'client' limit 1`);
  const [venue] = await q<{ id: string }>(`select id from venues limit 1`);
  const [role] = await q<{ id: string }>(`select id from roles where name = 'クローザー'`);
  const [rankB] = await q<{ id: string }>(`select id from ranks where name = 'B'`);
  const mkStaff = async (name: string, rate: number | null, referredBy: string | null = null) => {
    const [s] = await q<{ id: string }>(`insert into staff (name, rank_id, referred_by) values ($1, $2, $3) returning id`, [name, rankB.id, referredBy]);
    if (rate != null) await q(`insert into staff_private (staff_id, base_daily_rate) values ($1, $2)`, [s.id, rate]);
    return s.id;
  };
  const rankOnly = await mkStaff("ランクだけ テスト", null);
  const personal = await mkStaff("人ごと テスト", 20000);
  const newcomer = await mkStaff("紹介された テスト", null, rankOnly);
  const mkEvent = async (date: string) => (await q<{ id: string }>(`insert into events (client_id, venue_id, date, report_required) values ($1, $2, $3, false) returning id`, [client.id, venue.id, date]))[0].id;
  const event = await mkEvent(`${month}-10`);
  const other = await mkEvent(`${month}-11`);
  await q(`insert into assignments (event_id, staff_id, role_id, status, travel_steps) values ($1, $2, $4, 'confirmed', 2), ($1, $3, $4, 'confirmed', 0)`, [event, rankOnly, personal, role.id]);
  // 紹介された人は2回稼働（1回は当日不稼働なので数えない）
  await q(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $3, $4, 'confirmed'), ($2, $3, $4, 'confirmed')`, [event, other, newcomer, role.id]);
  const third = await mkEvent(`${month}-12`);
  await q(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'no_show')`, [third, newcomer, role.id]);
  ids = { event, rankOnly, personal, newcomer, events: [event, other, third] };
});

afterAll(async () => {
  await q(`delete from assignments where event_id = any($1)`, [ids.events]);
  await q(`delete from events where id = any($1)`, [ids.events]);
  await q(`delete from staff_private where staff_id = any($1)`, [[ids.rankOnly, ids.personal, ids.newcomer]]);
  await q(`update staff set referred_by = null where id = $1`, [ids.newcomer]);
  await q(`delete from staff where id = any($1)`, [[ids.newcomer, ids.rankOnly, ids.personal]]);
  await q(`delete from owner_settings where key in ('travel_allowance', 'referral_bonus')`);
  for (const s of saved) await q(`insert into owner_settings (key, value) values ($1, $2)`, [s.key, JSON.stringify(s.value)]);
  await closePool();
});

describe("お金の計算の材料", () => {
  it("人ごとの日当がない人にはランクの基準日当、遠方の回数と1回分の額を読み込む", async () => {
    const input = await loadMoneyInput({ month });
    const [rankB] = await q<{ base_daily_rate: number }>(`select base_daily_rate from rank_rates where rank_id = (select id from ranks where name = 'B')`);
    expect(input.staff.find((s) => s.id === ids.rankOnly)).toMatchObject({ baseDailyRate: null, rankDailyRate: rankB.base_daily_rate });
    expect(input.staff.find((s) => s.id === ids.personal)).toMatchObject({ baseDailyRate: 20000 });
    const a = await q<{ id: string }>(`select id from assignments where event_id = $1 and staff_id = $2`, [ids.event, ids.rankOnly]);
    expect(input.travelSteps).toContainEqual({ assignmentId: a[0].id, steps: 2 });
    expect(input.settings.travelStepAmount).toBe(1000);
  });

  it("友達紹介: 決めた回数（ここでは2回）稼働した人の紹介者が対象。当日不稼働は数えない", async () => {
    const settings = await getMoneySettings();
    expect(settings.referralBonus).toEqual({ amount: 15000, after: 2 });
    const targets = await getReferralBonusTargets(2);
    expect(targets.find((t) => t.staffId === ids.newcomer)).toMatchObject({ referrerId: ids.rankOnly, worked: 2, reachedOn: `${month}-11` });
    expect(await getReferralBonusTargets(3).then((t) => t.some((x) => x.staffId === ids.newcomer))).toBe(false);
  });
});
