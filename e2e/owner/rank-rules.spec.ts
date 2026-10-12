import { expect, test } from "@playwright/test";
import { cleanupEvent, makeEvent, one, sql } from "../helpers/db";

/**
 * Phase 12: ランク制度（オーナー）
 * - 遠方の上乗せ: 1回分の額を入れると、現場のお金の欄に「遠方 ＋1,000円」と出る
 * - 友達紹介: 「紹介してくれた人」を入れ、決めた回数稼働したら、支払いの画面からボーナスを調整額に足せる
 */
test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => isMobile, "お金の操作は PC で確かめる（スマホの表示は no-scroll で確認）");

const T = Array.from({ length: 4 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
let saved: { key: string; value: unknown }[] = [];
let ids = { referrer: "", newcomer: "", events: [] as string[] };

test.beforeAll(async () => {
  saved = await sql(`select key, value from owner_settings where key in ('travel_allowance', 'referral_bonus')`);
  const [referrer] = await sql<{ id: string }>(`insert into staff (name, kana) values ($1, 'しょうかいした') returning id`, [`紹介した ${T}`]);
  const [newcomer] = await sql<{ id: string }>(`insert into staff (name, kana) values ($1, 'しょうかいされた') returning id`, [`紹介された ${T}`]);
  ids = { referrer: referrer.id, newcomer: newcomer.id, events: [] };
});

test.afterAll(async () => {
  for (const e of ids.events) await cleanupEvent(e);
  await sql(`delete from payment_adjustments where staff_id = $1`, [ids.referrer]);
  await sql(`update staff set referred_by = null where id = $1`, [ids.newcomer]);
  await sql(`delete from staff where id = any($1)`, [[ids.newcomer, ids.referrer]]);
  await sql(`delete from owner_settings where key in ('travel_allowance', 'referral_bonus')`);
  for (const s of saved) await sql(`insert into owner_settings (key, value) values ($1, $2)`, [s.key, JSON.stringify(s.value)]);
});

test("お金の設定で遠方の1回分・紹介のボーナスを入れると、現場のお金の欄に遠方の額が出る", async ({ page }) => {
  await page.goto("/settings/money");
  await page.getByLabel(/遠方の上乗せ（最寄り駅から1時間30分/).fill("1000");
  await page.getByLabel(/友達紹介のボーナス（紹介した人の報酬に足す額）/).fill("15000");
  await page.getByLabel("紹介された人が何回稼働したら出すか").fill("2");
  await page.getByRole("button", { name: "遠方・紹介の設定を保存" }).click();
  await expect(page.getByText("遠方の上乗せ・友達紹介の設定を保存しました")).toBeVisible();

  const ev = await makeEvent("public.jst_today() + 21", { required: 1 });
  ids.events.push(ev.id);
  await sql(`insert into assignments (event_id, staff_id, role_id, status, travel_steps) values ($1, $2, $3, 'confirmed', 2)`, [ev.id, ids.referrer, ev.roleId]);
  await page.goto(`/events/${ev.id}`);
  await expect(page.getByText(/遠方 ＋2,000円/)).toBeVisible();
});

test("紹介してくれた人を入れ、2回稼働したら支払いの画面からボーナスを1回だけ足せる", async ({ page }) => {
  // 紹介された人の稼働（今日より前に2回）
  for (const d of ["public.jst_today() - 1", "public.jst_today() - 2"]) {
    const ev = await makeEvent(d, { required: 1 });
    ids.events.push(ev.id);
    await sql(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed')`, [ev.id, ids.newcomer, ev.roleId]);
  }
  await page.goto(`/staff/${ids.newcomer}/edit`);
  await page.getByLabel("紹介してくれた人（友達紹介）").selectOption({ label: `紹介した ${T}` });
  await page.getByRole("button", { name: "保存する" }).click();
  await expect(page.getByText("紹介してくれた人", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: `紹介した ${T}` }).first()).toBeVisible();

  await page.goto("/money/payments");
  const box = page.getByRole("region", { name: "友達紹介のボーナス" });
  const row = box.getByRole("listitem").filter({ hasText: `紹介した ${T}さん` });
  await expect(row).toContainText(`紹介: 紹介された ${T}さん（2回稼働`);
  await row.getByRole("button", { name: "15,000円を足す" }).click();
  await expect(page.getByText(`紹介した ${T}さんの調整額にボーナスを足しました`)).toBeVisible();
  await expect(row).toHaveCount(0);
  const adj = await one<{ amount: number; reason: string }>(`select amount, reason from payment_adjustments where staff_id = $1`, [ids.referrer]);
  expect(adj).toEqual({ amount: 15000, reason: `友達紹介のボーナス（紹介された ${T}さんが2回稼働）` });
  const [bonus] = await sql<{ referrer_staff_id: string }>(`select referrer_staff_id from referral_bonuses where referred_staff_id = $1`, [ids.newcomer]);
  expect(bonus.referrer_staff_id).toBe(ids.referrer);
});
