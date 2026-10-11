/**
 * Phase 6: キャンセル・当日不稼働のポップアップに出すもの（src/lib/data/alerts.ts）を、ローカルの DB で動かす。
 * - 操作した本人には出さない。ほかのメンバーには出る（欠員の人数つき）
 * - 「確認した」のあとは出ない
 * - 元に戻した（確定に戻した）ものは出ない
 */
import { createClient as createSupabase, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SEED_PASSWORD, SEED_USERS } from "../../scripts/seed/constants.mts";
import { closePool, getPool, localSupabase } from "./helpers";

let current: SupabaseClient;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current, createAnonClient: () => current }));

const { loadDropAlerts, markDropAlertsSeen } = await import("@/lib/data/alerts");

async function signIn(role: "owner" | "manager") {
  const { API_URL, PUBLISHABLE_KEY } = localSupabase();
  const client = createSupabase(API_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email: SEED_USERS[role].email, password: SEED_PASSWORD });
  if (error) throw error;
  return client;
}

const q = async <T>(sql: string, params: unknown[] = []) => (await getPool().query(sql, params)).rows as T[];
const clients: Record<"owner" | "manager", SupabaseClient> = {} as never;
let eventId = "";
let assignmentId = "";
let ownerSeen: { seen_at: string } | undefined;

beforeAll(async () => {
  clients.owner = await signIn("owner");
  clients.manager = await signIn("manager");
  [ownerSeen] = await q<{ seen_at: string }>(`select seen_at from alert_seen where user_id = $1`, [SEED_USERS.owner.id]);
  await q(`delete from alert_seen where user_id = $1`, [SEED_USERS.owner.id]);
  const [ev] = await q<{ id: string }>(
    `insert into events (client_id, venue_id, date)
     select (select id from companies where kind = 'client' order by id limit 1), (select id from venues order by id limit 1), jst_today() + 6
     returning id`,
  );
  eventId = ev.id;
  await q(`insert into event_requirements (event_id, role_id, required_count) select $1, id, 1 from roles where is_active order by sort_order limit 1`, [eventId]);
  const [a] = await q<{ id: string }>(
    `insert into assignments (event_id, staff_id, role_id, status)
     select $1, (select id from staff where status = 'active' order by id limit 1), (select id from roles where is_active order by sort_order limit 1), 'confirmed'
     returning id`,
    [eventId],
  );
  assignmentId = a.id;
});

afterAll(async () => {
  await q(`delete from staff_notes where assignment_id = $1`, [assignmentId]);
  await q(`delete from assignments where event_id = $1`, [eventId]);
  await q(`delete from event_requirements where event_id = $1`, [eventId]);
  await q(`delete from events where id = $1`, [eventId]);
  await q(`delete from alert_seen where user_id = $1`, [SEED_USERS.owner.id]);
  if (ownerSeen) await q(`insert into alert_seen (user_id, seen_at) values ($1, $2)`, [SEED_USERS.owner.id, ownerSeen.seen_at]);
  await closePool();
});

describe("キャンセル・当日不稼働のポップアップ", () => {
  it("管理者がキャンセルにすると、オーナーには欠員の人数つきで出て、管理者本人には出ない。確認したら出ない", async () => {
    const { error } = await clients.manager.from("assignments").update({ status: "cancelled", cancel_reason_code: "self" }).eq("id", assignmentId);
    expect(error).toBeNull();

    current = clients.owner;
    const forOwner = (await loadDropAlerts(SEED_USERS.owner.id)).filter((a) => a.eventId === eventId);
    expect(forOwner).toHaveLength(1);
    expect(forOwner[0]).toMatchObject({ status: "cancelled", shortage: 1 });
    expect(forOwner[0].staffName).not.toBe("");

    current = clients.manager;
    expect((await loadDropAlerts(SEED_USERS.manager.id)).filter((a) => a.eventId === eventId)).toEqual([]);

    current = clients.owner;
    await markDropAlertsSeen(SEED_USERS.owner.id, forOwner[0].createdAt);
    expect((await loadDropAlerts(SEED_USERS.owner.id)).filter((a) => a.eventId === eventId)).toEqual([]);
  });

  it("元に戻した（確定に戻した）ものは出ない", async () => {
    await q(`delete from alert_seen where user_id = $1`, [SEED_USERS.owner.id]);
    await clients.manager.from("assignments").update({ status: "confirmed", cancel_reason_code: null }).eq("id", assignmentId);
    current = clients.owner;
    expect((await loadDropAlerts(SEED_USERS.owner.id)).filter((a) => a.eventId === eventId)).toEqual([]);
  });
});
