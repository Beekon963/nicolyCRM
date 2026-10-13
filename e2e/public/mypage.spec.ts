import { expect, test } from "@playwright/test";
import { cleanupEvent, dropStaff, freeFutureDate, makeStaff, one, sql } from "../helpers/db";
import { expectNoHorizontalScroll } from "../helpers/layout";

/** 未来の現場（クローザー1名）に2人を打診中にしておく */
async function offerScenario() {
  const date = await freeFutureDate();
  const place = `正面入口-${Math.random().toString(36).slice(2, 7)}`;
  const closer = await one<{ id: string }>(`select id from roles where name = 'クローザー'`);
  const ev = await one<{ id: string }>(
    `insert into events (client_id, venue_id, date, start_time, end_time, meeting_time, meeting_place)
     values ((select id from companies where kind = 'client' limit 1), (select id from venues where address <> '' limit 1), $1, '10:00', '19:00', '09:30', $2)
     returning id`,
    [date, place],
  );
  await sql(`insert into event_requirements (event_id, role_id, required_count) values ($1, $2, 1)`, [ev.id, closer.id]);
  // 打診する2人はこのテストで作る（ほかのテストと同じ人を取り合わないように）
  const staff = [await makeStaff("打診 一郎"), await makeStaff("打診 二郎")].map((s) => ({ id: s.id, mypage_token: s.token }));
  for (const s of staff) await sql(`insert into assignments (event_id, staff_id, role_id) values ($1, $2, $3)`, [ev.id, s.id, closer.id]);
  return { eventId: ev.id, date, place, a: staff[0], b: staff[1] };
}

test("「参加できる」を押すと確定になり、定員を超えたら補欠になる", async ({ page }) => {
  const s = await offerScenario();
  try {
    await page.goto(`/m/${s.a.mypage_token}`);
    await expectNoHorizontalScroll(page);
    const card = page.locator("section").filter({ hasText: s.place });
    await card.getByRole("button", { name: "参加できる" }).click();
    await expect(page.getByText("確定しました").first()).toBeVisible();
    expect((await one<{ status: string }>(`select status from assignments where event_id = $1 and staff_id = $2`, [s.eventId, s.a.id])).status).toBe("confirmed");

    await page.goto(`/m/${s.b.mypage_token}`);
    await page.locator("section").filter({ hasText: s.place }).getByRole("button", { name: "参加できる" }).click();
    await expect(page.getByText(/「補欠」になりました/).first()).toBeVisible();
    expect((await one<{ status: string }>(`select status from assignments where event_id = $1 and staff_id = $2`, [s.eventId, s.b.id])).status).toBe("waitlisted");
  } finally {
    await cleanupEvent(s.eventId);
    await dropStaff(s.a.id, s.b.id);
  }
});

test("翌月の稼働可能日を30秒程度で提出でき、候補一覧に反映される", async ({ page }) => {
  // このテストだけの人（ほかのテストと同じ人の稼働可能日を取り合わないように）
  const t = await makeStaff("提出 一郎");
  const staff = { id: t.id, mypage_token: t.token, name: t.name };
  let eventId = "";
  try {
    const next = await one<{ m: string; d10: string }>(
      `select to_char(date_trunc('month', jst_today()) + interval '1 month', 'YYYY-MM') as m,
              to_char(date_trunc('month', jst_today()) + interval '1 month' + interval '9 days', 'YYYY-MM-DD') as d10`,
    );
    const started = Date.now();
    await page.goto(`/m/${staff.mypage_token}/availability`);
    await expectNoHorizontalScroll(page);
    const day10 = page.getByRole("button", { name: new RegExp(`^${Number(next.m.slice(5))}月10日 `) });
    await day10.click(); // ○
    await expect(day10).toHaveAccessibleName(/稼働できる/);
    await page.getByRole("button", { name: new RegExp(`^${Number(next.m.slice(5))}月11日 `) }).click();
    await page.getByRole("button", { name: new RegExp(`^${Number(next.m.slice(5))}月11日 `) }).click(); // △
    await page.getByRole("button", { name: "未入力の日を全部 ×" }).click();
    await page.getByRole("button", { name: /提出する/ }).click();
    await expect(page.getByText("提出しました")).toBeVisible();
    expect(Date.now() - started).toBeLessThan(30_000);

    const rows = await sql<{ date: string; status: string }>(
      `select to_char(date, 'YYYY-MM-DD') as date, status from availability where staff_id = $1 and date in ($2::date, $2::date + 1)`,
      [staff.id, next.d10],
    );
    expect(Object.fromEntries(rows.map((r) => [r.date, r.status]))[next.d10]).toBe("ok");

    // 候補一覧（DB 関数）に反映される
    const ev = await one<{ id: string }>(
      `insert into events (client_id, venue_id, date) values ((select id from companies where kind = 'client' limit 1), (select id from venues limit 1), $1) returning id`,
      [next.d10],
    );
    eventId = ev.id;
    const cand = await one<{ availability: string }>(`select availability from event_candidates($1) where staff_id = $2`, [ev.id, staff.id]);
    expect(cand.availability).toBe("ok");
  } finally {
    if (eventId) await cleanupEvent(eventId);
    await dropStaff(staff.id);
  }
});

test("稼働日の夜、件数・コメントを1分以内に報告できる（日当は交通費込みなので交通費の欄はない）", async ({ page }) => {
  const closer = await one<{ id: string }>(`select id from roles where name = 'クローザー'`);
  // このテストだけの人（同じ日に、ほかのテストの現場が同じ人に入らないように）
  const t = await makeStaff("報告 一郎");
  const staff = { id: t.id, mypage_token: t.token };
  const ev = await one<{ id: string; venue: string }>(
    `insert into events (client_id, venue_id, date)
     values ((select id from companies where kind = 'client' and not exists (select 1 from company_items ci where ci.company_id = companies.id) limit 1),
             (select id from venues where address <> '' order by random() limit 1), jst_today())
     returning id, (select name from venues where id = venue_id) as venue`,
  );
  try {
    const a = await one<{ id: string }>(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed') returning id`, [ev.id, staff.id, closer.id]);

    const started = Date.now();
    await page.goto(`/m/${staff.mypage_token}/report`);
    await expectNoHorizontalScroll(page);
    await page.getByRole("link", { name: new RegExp(ev.venue) }).first().click();
    await page.getByRole("button", { name: "MNPを1増やす" }).click();
    await page.getByRole("button", { name: "MNPを1増やす" }).click();
    await page.getByRole("button", { name: "新規を1増やす" }).click();
    await page.getByLabel("一言コメント（任意）").fill("午後から好調");
    await expect(page.getByText("日当は交通費込みです（交通費の申請はありません）。")).toBeVisible();
    await expect(page.getByLabel("交通費の金額")).toHaveCount(0);
    await page.getByRole("button", { name: "送信する" }).click();
    await expect(page.getByText("報告を送信しました")).toBeVisible();
    expect(Date.now() - started).toBeLessThan(60_000);

    const items = await sql<{ name: string; reported_count: number }>(
      `select i.name, ri.reported_count from report_items ri join items i on i.id = ri.item_id where ri.assignment_id = $1 and ri.reported_count > 0`,
      [a.id],
    );
    expect(Object.fromEntries(items.map((i) => [i.name, i.reported_count]))).toEqual({ MNP: 2, 新規: 1 });
    expect(await sql(`select 1 from expenses where assignment_id = $1 and kind = 'transport'`, [a.id])).toHaveLength(0);
  } finally {
    await cleanupEvent(ev.id);
    await dropStaff(staff.id);
  }
});

test("使えない URL では何も表示しない", async ({ page }) => {
  await page.goto("/m/this-is-not-a-valid-token-xxxxxxxxxxxxxxxxxxxxxxxxx");
  await expect(page.getByRole("heading", { name: "マイページを開けません" })).toBeVisible();
  await expect(page.getByText("URLが再発行された可能性")).toBeVisible();
});
