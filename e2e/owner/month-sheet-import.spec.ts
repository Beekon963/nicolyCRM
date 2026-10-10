import { expect, test } from "@playwright/test";
import { cleanupEvent, freeFutureDate, one, sql } from "../helpers/db";
import { expectNoHorizontalScroll } from "../helpers/layout";

/**
 * 今の月のシート（上の段: 単価/現場/人数、下の段: 単価/場所/シフト）を CSV で取り込む（Phase 1.5）。
 * 名前・会場は架空かダミーデータのもの。
 */
test("月のシートから、現場・アサイン・稼働可能日・単価を取り込める（2回取り込んでも重ならない）", async ({ page }) => {
  test.setTimeout(90_000);
  const id = Math.random().toString(36).slice(2, 7);
  const future = await freeFutureDate();
  const month = future.slice(0, 7);
  const m = Number(month.slice(5));
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), m, 0)).getUTCDate();
  const day = (d: number) => `${month}-${String(d).padStart(2, "0")}`;

  const client = await one<{ id: string; name: string }>(`select id, name from companies where kind = 'client' and is_active order by created_at limit 1`);
  const venue = await one<{ id: string; name: string }>(`select id, name from venues where is_active and name not like '%E2E%' order by created_at limit 1`);
  const staff = await sql<{ id: string; name: string }>(
    `select id, name from staff s where status = 'active' and (select count(*) from staff x where x.name = s.name) = 1 order by created_at limit 2`,
  );
  const newVenue = `E2E新会場${id}`;
  const newClient = `E2E新取引先${id}`;
  // 取り込む日に、テスト用以外の現場・アサイン・稼働可能日がないようにする
  const dates = [3, 4, 5, 6, 7].map(day);
  await sql(`delete from availability where staff_id = any($1) and date = any($2::date[])`, [staff.map((s) => s.id), dates]);
  const pre = await sql<{ id: string }>(`select id from events where date = any($1::date[]) and venue_id = $2`, [dates, venue.id]);
  for (const e of pre) await cleanupEvent(e.id);

  const cols = Array.from({ length: lastDay }, (_, i) => `${m}/${i + 1}`);
  const row = (head: string[], cells: Record<number, string> = {}) => {
    const r = Array(4 + lastDay).fill("");
    head.forEach((v, i) => (r[i] = v));
    for (const [d, v] of Object.entries(cells)) r[3 + Number(d)] = v;
    return r;
  };
  const rows = [
    ["", "", "", "日付", ...cols, "出勤日数"],
    ["ランク", "名前", "最寄り駅", "曜日", ...cols.map(() => "月")],
    row([client.name, "", "", "単価"], { 3: "¥22,000" }),
    row(["", "", "", "現場"], { 3: venue.name }),
    row(["", "", "", "人数"], { 3: "2" }),
    row(["", "", "", "単価"]),
    row(["", "", "", "現場"], { 4: newVenue }),
    row(["", "", "", "人数"], { 4: "1" }),
    row([newClient, "", "", "単価"], { 5: "21000円＋交通費別" }),
    row(["", "", "", "現場"], { 5: venue.name }),
    row(["", "", "", "人数"], { 5: "1" }),
    row(["", "", "", "人数"]),
    row(["S", staff[0].name, "", "単価"], { 3: "15,000" }),
    row(["", "", "", "場所"], { 3: venue.name, 7: "研修" }),
    row(["", "", "", "シフト"], { 3: "⭕️", 6: "🔺" }),
    row(["", staff[1].name, "", "単価"]),
    row(["", "", "", "場所"], { 4: newVenue }),
    row(["", "", "", "シフト"]),
    row(["", `架空 太郎${id}`, "", "単価"]),
    row(["", "", "", "場所"], { 3: venue.name }),
    row(["", "", "", "シフト"]),
  ];
  const csv = rows.map((r) => r.map((c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n");

  async function runImport() {
    await page.goto("/import");
    await page.getByRole("button", { name: /月の稼働表/ }).click();
    await page.getByLabel("月のシートの CSV").setInputFiles({ name: `${month}.csv`, mimeType: "text/csv", buffer: Buffer.from(csv, "utf-8") });
    await page.getByLabel("対象の月").fill(month);
    await expect(page.getByRole("region", { name: "取り込む内容" })).toContainText("現場 3件");
    await expectNoHorizontalScroll(page);
  }

  await runImport();
  const summary = page.getByRole("region", { name: "取り込む内容" });
  await expect(summary).toContainText("新しく作る 3件");
  await expect(summary).toContainText("アサイン（確定） 2件");
  await expect(page.getByText(`架空 太郎${id}`, { exact: true })).toBeVisible();
  await expect(page.getByText("研修", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /取り込む（現場 3件）/ }).click();
  await expect(page.getByText("取り込みました").first()).toBeVisible();

  try {
    const ev = await one<{ id: string; report_required: boolean; required: number; rate: number }>(
      `select e.id, e.report_required, r.required_count as required, er.amount as rate
         from events e join event_requirements r on r.event_id = e.id left join event_rates er on er.event_id = e.id
        where e.date = $1 and e.venue_id = $2 and e.client_id = $3`,
      [day(3), venue.id, client.id],
    );
    expect(ev).toMatchObject({ report_required: true, required: 2, rate: 22000 });
    const a = await one<{ status: string; daily: number; notice: string | null }>(
      `select a.status, ap.daily_rate_override as daily, a.confirm_notice_sent_at as notice
         from assignments a left join assignment_private ap on ap.assignment_id = a.id where a.event_id = $1 and a.staff_id = $2`,
      [ev.id, staff[0].id],
    );
    expect(a.status).toBe("confirmed");
    expect(a.daily).toBe(15000);
    expect(a.notice).not.toBeNull();
    const av = await sql<{ date: string; status: string }>(
      `select to_char(date, 'YYYY-MM-DD') as date, status from availability where staff_id = $1 and date = any($2::date[]) order by date`,
      [staff[0].id, dates],
    );
    expect(av).toEqual([
      { date: day(3), status: "ok" },
      { date: day(6), status: "maybe" },
    ]);
    const nv = await one<{ id: string }>(`select id from venues where name = $1`, [newVenue]);
    expect(await sql(`select 1 from assignments a join events e on e.id = a.event_id where e.venue_id = $1 and a.staff_id = $2`, [nv.id, staff[1].id])).toHaveLength(1);
    const nc = await one<{ status: string; bill: boolean }>(
      `select c.status, b.bill_transport as bill from companies c join company_billing b on b.company_id = c.id where c.name = $1`,
      [newClient],
    );
    expect(nc).toEqual({ status: "active", bill: true });
    // 研修（上の段にない）と名簿にいない人は取り込まない
    expect(await sql(`select 1 from venues where name = '研修' and created_at > now() - interval '5 minutes'`)).toHaveLength(0);

    // 2回目: すでにある現場を使い回し、重ならない
    await runImport();
    await expect(summary).toContainText("すでにある 3件");
    await page.getByRole("button", { name: /取り込む（現場 3件）/ }).click();
    await expect(page.getByText("取り込みました").first()).toBeVisible();
    const counts = await one<{ events: number; asg: number }>(
      `select count(distinct e.id)::int as events, count(a.id)::int as asg from events e left join assignments a on a.event_id = e.id
        where e.date = any($1::date[]) and e.venue_id in ($2, $3)`,
      [dates, venue.id, nv.id],
    );
    expect(counts).toEqual({ events: 3, asg: 2 });
  } finally {
    const evs = await sql<{ id: string }>(
      `select e.id from events e left join venues v on v.id = e.venue_id where e.date = any($1::date[]) and (e.venue_id = $2 or v.name = $3)`,
      [dates, venue.id, newVenue],
    );
    for (const e of evs) {
      await sql(`delete from event_rates where event_id = $1`, [e.id]);
      await cleanupEvent(e.id);
    }
    await sql(`delete from availability where staff_id = any($1) and date = any($2::date[])`, [staff.map((s) => s.id), dates]);
    await sql(`delete from company_billing where company_id in (select id from companies where name = $1)`, [newClient]);
    await sql(`delete from companies where name = $1`, [newClient]);
    await sql(`delete from venues where name = $1`, [newVenue]);
  }
});
