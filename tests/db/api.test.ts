/**
 * 受け入れテスト（要件 §10）: 管理者でログインして Supabase の API を直接呼んでも、金額は返らない。
 * 画面を通さず、ブラウザから直接 API を叩かれた場合を想定する。
 */
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SEED_PASSWORD, SEED_USERS, SENTINELS } from "../../scripts/seed/constants.mts";
import { localSupabase } from "./helpers";
import { MONEY_TABLES } from "./money-tables";

async function signIn(role: "owner" | "manager") {
  const { API_URL, PUBLISHABLE_KEY } = localSupabase();
  const client = createClient(API_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: SEED_USERS[role].email, password: SEED_PASSWORD });
  if (error) throw error;
  return client;
}

describe("API を直接呼んだとき", () => {
  it("管理者には金額系テーブルが空で返る（オーナーには返る）", async () => {
    const manager = await signIn("manager");
    const owner = await signIn("owner");
    for (const t of MONEY_TABLES) {
      const m = await manager.from(t).select("*");
      expect(m.data ?? [], t).toEqual([]);
    }
    const o = await owner.from("staff_private").select("*");
    expect(o.data?.length).toBeGreaterThan(0);
  });

  it("管理者がスタッフや現場をまとめて取っても、目印の金額は含まれない", async () => {
    const manager = await signIn("manager");
    const results = await Promise.all([
      manager.from("staff").select("*, staff_private(*)"),
      manager.from("assignments").select("*, assignment_private(*)"),
      manager.from("companies").select("*, company_billing(*), client_rates(*)"),
      manager.from("event_overview").select("*"),
      manager.from("ranks").select("*, rank_rates(*)"),
    ]);
    const body = JSON.stringify(results.map((r) => r.data));
    for (const s of Object.values(SENTINELS)) expect(body).not.toContain(String(s));
  });

  it("ログインしていないと何も取れない", async () => {
    const { API_URL, PUBLISHABLE_KEY } = localSupabase();
    const anon = createClient(API_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } });
    const r = await anon.from("staff").select("*");
    expect(r.data ?? []).toEqual([]);
  });
});
