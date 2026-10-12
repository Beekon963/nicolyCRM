/**
 * LINE のトーク履歴から作った「件数の記録だけ」の現場（events.counts_only）は、お金の計算に入れない（Phase 11）。
 * 実績の分析・平均獲得件数には入る
 */
import { createClient as createSupabase, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SEED_PASSWORD, SEED_USERS } from "../../scripts/seed/constants.mts";
import { closePool, getPool, localSupabase } from "./helpers";

let current: SupabaseClient;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current, createAnonClient: () => current }));
const { loadMoneyInput } = await import("@/lib/data/money");

const q = async <T>(sql: string, params: unknown[] = []) => (await getPool().query(sql, params)).rows as T[];
let made: { counts: string; normal: string } = { counts: "", normal: "" };
const month = "2025-03";

beforeAll(async () => {
  const { API_URL, PUBLISHABLE_KEY } = localSupabase();
  current = createSupabase(API_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { error } = await current.auth.signInWithPassword({ email: SEED_USERS.owner.email, password: SEED_PASSWORD });
  if (error) throw error;
  const [client] = await q<{ id: string }>(`select id from companies where kind = 'client' limit 1`);
  const [venue] = await q<{ id: string }>(`select id from venues limit 1`);
  const mk = async (countsOnly: boolean) =>
    (await q<{ id: string }>(`insert into events (client_id, venue_id, date, report_required, counts_only) values ($1, $2, $3, false, $4) returning id`, [client.id, venue.id, `${month}-10`, countsOnly]))[0].id;
  made = { counts: await mk(true), normal: await mk(false) };
});

afterAll(async () => {
  await q(`delete from events where id = any($1)`, [[made.counts, made.normal]]);
  await closePool();
});

describe("件数の記録だけの現場", () => {
  it("お金の計算に読み込まない（記録のみでも、ふつうの現場は読み込む）", async () => {
    const input = await loadMoneyInput({ month });
    const ids = input.events.map((e) => e.id);
    expect(ids).toContain(made.normal);
    expect(ids).not.toContain(made.counts);
  });
});
