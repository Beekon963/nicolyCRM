import { expect, test } from "@playwright/test";
import { addDays, todayJst } from "../../src/lib/date";
import { one, sql } from "../helpers/db";
import { expectNoHorizontalScroll } from "../helpers/layout";

/**
 * Phase 4-3: オンライン研修の予約（TimeRex のような日程調整）。
 * オーナーが枠を作り、予約用リンクを作る → 受ける人がログインなしで日時を選んで予約 → 控えの画面でキャンセル。
 * 管理画面では電話などの予約を入れ、取り消しは「元に戻す」で戻せる。
 */
// 予約用リンクは1つだけなので、PC のプロジェクトだけで順番に確かめる（予約する人の画面はスマホ幅で開く）
test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => isMobile, "予約用リンクは1つだけなので、PC のプロジェクトでまとめて確かめる");

const tag = Math.random().toString(36).slice(2, 6);
const TITLE = `E2E研修${tag}`;
let linkPath = "";
let slotId = "";

test.afterAll(async () => {
  await sql(`delete from training_bookings where slot_id in (select id from training_slots where title like $1)`, [`${TITLE}%`]);
  await sql(`delete from training_slots where title like $1`, [`${TITLE}%`]);
});

test("オーナー: 日付・時刻・長さ・数を選ぶだけで、枠をまとめて作れる", async ({ page }) => {
  await page.goto("/trainings");
  await page.getByRole("button", { name: "研修の枠を作る" }).click();
  const form = page.locator("form", { has: page.getByRole("heading", { name: "研修の枠を作る" }) });
  await form.getByRole("group", { name: "日付" }).getByRole("button").nth(3).click();
  await form.getByRole("button", { name: "19:00" }).click();
  await form.getByRole("button", { name: "30分" }).click();
  await form.getByRole("button", { name: "続けて作る数を1増やす" }).click();
  await form.getByText("詳細（研修の名前・参加の URL・ご案内）").click();
  await form.getByLabel("研修の名前").fill(TITLE);
  await form.getByLabel("参加の URL（Zoom・Google Meet など）").fill("https://meet.example.com/e2e");
  await expect(form.getByText("19:00〜20:00（30分 × 2）… 合計 2枠")).toBeVisible();
  await form.getByRole("button", { name: "2枠を作る" }).click();
  await expect(page.getByText("2枠を作りました")).toBeVisible();
  const rows = await sql<{ id: string; t: string }>(
    `select id, to_char(starts_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI') as t from training_slots where title = $1 order by starts_at`,
    [TITLE],
  );
  const day = addDays(todayJst(), 3);
  expect(rows.map((r) => r.t)).toEqual([`${day} 19:00`, `${day} 19:30`]);
  slotId = rows[0].id;
  await expect(page.locator(`[data-slot="${slotId}"]`).getByText("予約 0/1")).toBeVisible();
});

test("予約用リンクを作り、ログインなしで日時を選んで予約・キャンセルできる（スマホ幅）", async ({ page, browser }) => {
  await sql(`delete from share_links where kind = 'training'`);
  await page.goto("/trainings");
  await page.getByRole("button", { name: "予約用リンク" }).click();
  const dialog = page.getByRole("dialog", { name: "予約用リンク" });
  await dialog.getByRole("button", { name: "リンクを作る" }).click();
  await expect(dialog.getByText("受付中")).toBeVisible();
  const url = (await dialog.getByTestId("training-url").textContent())!.trim();
  expect(url).toMatch(/\/t\/[\w-]{40,}$/);
  linkPath = new URL(url).pathname;

  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });
  const guest = await ctx.newPage();
  await guest.goto(linkPath);
  await expect(guest.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expectNoHorizontalScroll(guest);
  await guest.locator(`[data-slot="${slotId}"]`).click();
  await guest.getByLabel("お名前").fill(`予約${tag}`);
  await guest.getByLabel("連絡先（任意）").fill("090-0000-1234");
  await guest.getByRole("button", { name: "この日時で予約する" }).click();
  await expect(guest).toHaveURL(/\/t\/b\/[\w-]{40,}$/);
  await expect(guest.getByText("予約しました")).toBeVisible();
  await expect(guest.getByRole("link", { name: "オンラインの研修に入る" })).toHaveAttribute("href", "https://meet.example.com/e2e");
  await expectNoHorizontalScroll(guest);
  const bookingPath = new URL(guest.url()).pathname;

  // 満席になった枠は、予約の画面で押せない
  await guest.goto(linkPath);
  await expect(guest.locator(`[data-slot="${slotId}"]`)).toBeDisabled();
  await expect(guest.locator(`[data-slot="${slotId}"]`)).toContainText("満席");

  // 管理画面に予約が出る（名前・連絡先）
  await page.goto("/trainings");
  const card = page.locator(`[data-slot="${slotId}"]`);
  await expect(card.getByText(`予約${tag}`)).toBeVisible();
  await expect(card.getByText("満席 1/1")).toBeVisible();

  // 控えの画面からキャンセル
  await guest.goto(bookingPath);
  await guest.getByRole("button", { name: "予約をキャンセルする" }).click();
  await guest.getByRole("button", { name: "キャンセルする", exact: true }).click();
  await expect(guest.getByText("この予約はキャンセルしました")).toBeVisible();
  const b = await one<{ cancelled: boolean }>(`select cancelled_at is not null as cancelled from training_bookings where slot_id = $1`, [slotId]);
  expect(b.cancelled).toBe(true);

  // 使えない鍵では開けない
  await guest.goto(`/t/${"x".repeat(43)}`);
  await expect(guest.getByText("予約のページを開けません")).toBeVisible();
  await ctx.close();
});

test("管理画面: 電話などで受けた予約を入れ、取り消しは「元に戻す」で戻せる", async ({ page }) => {
  await page.goto("/trainings");
  const card = page.locator(`[data-slot="${slotId}"]`);
  await card.getByRole("button", { name: "予約を入れる" }).click();
  await card.getByLabel("お名前").fill(`電話${tag}`);
  await card.getByRole("button", { name: "入れる" }).click();
  await expect(page.getByText("予約を入れました")).toBeVisible();
  await expect(card.getByText(`電話${tag}`)).toBeVisible();
  await expect(card.getByText("（こちらで入力）")).toBeVisible();

  // 控えを LINE で送れる
  await card.getByRole("button", { name: "控えを送る" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/\/t\/b\/[\w-]{40,}/)).toBeVisible();
  await page.keyboard.press("Escape");

  await card.getByRole("button", { name: "取り消す" }).click();
  await expect(page.getByText("予約を取り消しました")).toBeVisible();
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect
    .poll(async () => (await one<{ n: number }>(`select count(*)::int as n from training_bookings where slot_id = $1 and cancelled_at is null`, [slotId])).n)
    .toBe(1);
  await page.reload();
  await expect(card.getByText(`電話${tag}`)).toBeVisible();
});

test("管理画面: 枠を止めると、予約の画面に出なくなる", async ({ page, browser }) => {
  const second = await one<{ id: string }>(`select id from training_slots where title = $1 order by starts_at desc limit 1`, [TITLE]);
  await page.goto("/trainings");
  const card = page.locator(`[data-slot="${second.id}"]`);
  await card.getByRole("button", { name: "止める" }).click();
  await expect(card.getByText("止めています")).toBeVisible();
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const guest = await ctx.newPage();
  await guest.goto(linkPath);
  await expect(guest.getByRole("heading", { name: "研修の予約" })).toBeVisible();
  await expect(guest.locator(`[data-slot="${second.id}"]`)).toHaveCount(0);
  await ctx.close();
});
