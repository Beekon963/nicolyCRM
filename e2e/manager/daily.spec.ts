import { expect, test } from "@playwright/test";
import { cleanupEvent, dropStaff, makeEvent, makeStaff, one, sql } from "../helpers/db";
import { expectNoHorizontalScroll, gotoReady } from "../helpers/layout";

const uniq = () => Math.random().toString(36).slice(2, 7);

test("欠員がホームに赤で出て、埋まると消える（埋まり具合は明日の分）", async ({ page }) => {
  const ev = await makeEvent("jst_today() + 1", { required: 1 });
  const staff = await makeStaff("欠員 一郎");
  try {
    await page.goto("/");
    await expectNoHorizontalScroll(page);
    const row = page.locator(`a[href="/events/${ev.id}/candidates"]`);
    await expect(row).toContainText(ev.venue);
    await expect(row).toContainText("欠1");
    await expect(row).toHaveAttribute("data-alert", "true");
    // 埋まり具合のゲージ: 明日の欠員があるので「あと〇人」が赤で出る（今日の分はもう見ない。Phase 13）
    await expect(page.getByTestId("home-fill").getByRole("meter", { name: "明日の埋まり具合" })).toBeVisible();
    await expect(page.getByTestId("home-fill").getByRole("meter", { name: "今日の埋まり具合" })).toHaveCount(0);
    await expect(page.getByTestId("home-fill")).toContainText("あと");
    await sql(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed')`, [ev.id, staff.id, ev.roleId]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "要対応" })).toBeVisible();
    await expect(page.locator(`a[href="/events/${ev.id}/candidates"]`)).toHaveCount(0);
  } finally {
    await cleanupEvent(ev.id);
    await dropStaff(staff.id);
  }
});

test("実績の未報告がホームに出る", async ({ page }) => {
  const ev = await makeEvent("jst_today() - 1", { required: 1 });
  const staff = await makeStaff("未報告 一郎");
  try {
    await sql(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed')`, [ev.id, staff.id, ev.roleId]);
    await page.goto("/");
    await expect(page.getByRole("link", { name: new RegExp(`${staff.name} — .*${ev.venue}`) }).first()).toBeVisible();
  } finally {
    await cleanupEvent(ev.id);
    await dropStaff(staff.id);
  }
});

test("管理者が速報 → 確定を入力でき、差分理由と履歴が残る", async ({ page }) => {
  const ev = await makeEvent("jst_today()", { required: 1 });
  const staff = await makeStaff("速報 一郎");
  try {
    const a = await one<{ id: string }>(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed') returning id`, [ev.id, staff.id, ev.roleId]);
    const mnp = await one<{ id: string }>(`select id from items where name = 'MNP'`);
    await sql(`insert into reports (assignment_id, submitted_at, source, comment) values ($1, now(), 'self', '好調')`, [a.id]);
    await sql(`insert into report_items (assignment_id, item_id, reported_count) values ($1, $2, 3)`, [a.id, mnp.id]);

    await gotoReady(page, `/results?event=${ev.id}`);
    await expectNoHorizontalScroll(page);
    await expect(page.getByText("「好調」")).toBeVisible();
    // 3件 → 2件に（1件は否認）
    await page.getByRole("button", { name: `${staff.name}のMNPの確定件数を1減らす` }).click();
    await page.getByRole("button", { name: "確定する" }).click();
    await expect(page.getByText("速報と違う件数には理由を選んでください")).toBeVisible();
    await page.getByLabel("MNPの差分の理由").selectOption("rejected");
    await page.getByRole("button", { name: "確定する" }).click();
    await expect(page.getByText(`${staff.name}さん: 確定しました`)).toBeVisible();

    const ri = await one<{ reported_count: number; confirmed_count: number; diff_reason: string }>(
      `select reported_count, confirmed_count, diff_reason from report_items where assignment_id = $1 and item_id = $2`,
      [a.id, mnp.id],
    );
    expect(ri).toEqual({ reported_count: 3, confirmed_count: 2, diff_reason: "rejected" });

    await page.getByRole("button", { name: "履歴" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("MNP の確定: − → 2")).toBeVisible();
    await expect(dialog.getByText("理由: 否認")).toBeVisible();
  } finally {
    await cleanupEvent(ev.id);
    await dropStaff(staff.id);
  }
});

test("2人で分けた 0.5 件のような件数も、そのまま確定できる（Phase 11）", async ({ page }) => {
  const ev = await makeEvent("jst_today() - 4", { required: 1 });
  // このテストだけの人（ほかのテストと同じ日に同じ人を確定にしない）
  const staff = await makeStaff("分け 一郎");
  try {
    const a = await one<{ id: string }>(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed') returning id`, [ev.id, staff.id, ev.roleId]);
    const mnp = await one<{ id: string }>(`select id from items where name = 'MNP'`);
    await sql(`insert into reports (assignment_id, submitted_at, source) values ($1, now(), 'self')`, [a.id]);
    await sql(`insert into report_items (assignment_id, item_id, reported_count) values ($1, $2, 0.5)`, [a.id, mnp.id]);

    await gotoReady(page, `/results?event=${ev.id}`);
    await expect(page.getByText("速報 0.5")).toBeVisible();
    await page.getByRole("textbox", { name: `${staff.name}のMNPの確定件数`, exact: true }).fill("1.5");
    await page.getByLabel("MNPの差分の理由").selectOption("input_error");
    await page.getByRole("button", { name: "確定する" }).click();
    await expect(page.getByText(`${staff.name}さん: 確定しました`)).toBeVisible();
    const ri = await one<{ confirmed_count: number }>(`select confirmed_count from report_items where assignment_id = $1 and item_id = $2`, [a.id, mnp.id]);
    expect(ri.confirmed_count).toBe(1.5);
  } finally {
    await cleanupEvent(ev.id);
    await dropStaff(staff.id);
  }
});

test("交通費を承認でき、元に戻せる", async ({ page }) => {
  const ev = await makeEvent("jst_today() - 2", { required: 1 });
  const staff = await makeStaff("交通 一郎");
  try {
    const a = await one<{ id: string }>(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed') returning id`, [ev.id, staff.id, ev.roleId]);
    const memo = `テスト区間${uniq()}`;
    const x = await one<{ id: string }>(`insert into expenses (assignment_id, staff_id, kind, amount, memo) values ($1, $2, 'transport', 1230, $3) returning id`, [a.id, staff.id, memo]);
    await page.goto("/expenses");
    await expectNoHorizontalScroll(page);
    const item = page.getByRole("listitem").filter({ hasText: memo });
    await expect(item).toContainText("1,230円");
    await item.getByRole("button", { name: "承認" }).click();
    await expect(page.getByText("1件 承認しました")).toBeVisible();
    expect((await one<{ status: string }>(`select status from expenses where id = $1`, [x.id])).status).toBe("approved");
    await page.getByRole("button", { name: "元に戻す" }).click();
    await expect.poll(async () => (await one<{ status: string }>(`select status from expenses where id = $1`, [x.id])).status).toBe("pending");
  } finally {
    await cleanupEvent(ev.id);
    await dropStaff(staff.id);
  }
});

test("稼働可能日を管理者が代理入力でき、入力元が「管理者」で残る", async ({ page }) => {
  const staff = await makeStaff("代理 一郎");
  try {
    const next = await one<{ m: string }>(`select to_char(date_trunc('month', jst_today()) + interval '1 month', 'YYYY-MM') as m`);
    await gotoReady(page, `/availability/${staff.id}?month=${next.m}`);
    await expectNoHorizontalScroll(page);
    await page.getByRole("button", { name: new RegExp(`^${Number(next.m.slice(5))}月15日 `) }).click();
    await page.getByRole("button", { name: "代理で提出する" }).click();
    await expect(page.getByText("代理で提出しました")).toBeVisible();
    const av = await one<{ status: string; source: string }>(`select status, source from availability where staff_id = $1 and date = $2::date`, [staff.id, `${next.m}-15`]);
    expect(av).toEqual({ status: "ok", source: "admin" });
    const sub = await one<{ source: string }>(`select source from availability_submissions where staff_id = $1 and month = $2::date`, [staff.id, `${next.m}-01`]);
    expect(sub.source).toBe("admin");
  } finally {
    await dropStaff(staff.id);
  }
});

test("横断検索: カタカナで探してもひらがなの かな に一致し、電話番号はハイフンなしでも見つかる", async ({ page }) => {
  await page.goto(`/search?q=${encodeURIComponent("ホンダ")}`);
  await expect(page.getByRole("link", { name: /本田 直樹/ })).toBeVisible();
  await page.goto("/search?q=09000000001");
  await expect(page.getByRole("link", { name: /本田 直樹/ })).toBeVisible();
  await expectNoHorizontalScroll(page);
});
