import { expect, test } from "@playwright/test";
import { one } from "../helpers/db";
import { expectNoHorizontalScroll } from "../helpers/layout";

/**
 * 受け入れテスト（要件 §10 Phase 1）: 全画面がスマホ幅 375px で横スクロールなし。
 * オーナーはすべての画面を開けるので、オーナーで全画面を回る。画面を足したらここにも足す。
 */
test("全画面がスマホ幅 375px で横スクロールしない", async ({ page, isMobile }) => {
  test.skip(!isMobile, "スマホ幅だけ確認する");
  test.setTimeout(180_000);
  const ids = await one<{ staff: string; venue: string; company: string; event: string; past_event: string; token: string; assignment: string }>(`
    select (select id from staff order by created_at limit 1) as staff,
           (select id from venues order by created_at limit 1) as venue,
           (select id from companies where kind = 'client' order by created_at limit 1) as company,
           (select id from events where date >= jst_today() order by date limit 1) as event,
           (select id from events where date < jst_today() order by date desc limit 1) as past_event,
           (select mypage_token from staff where status = 'active' order by created_at limit 1) as token,
           (select a.id from assignments a join events e on e.id = a.event_id
             where a.status = 'confirmed' and e.date <= jst_today() and e.date >= jst_today() - 7
               and a.staff_id = (select id from staff where status = 'active' order by created_at limit 1) limit 1) as assignment`);
  const pages = [
    "/",
    "/search?q=サンプル",
    "/events",
    "/events?view=calendar",
    "/events/board",
    "/events/new",
    "/events/bulk",
    `/events/${ids.event}`,
    `/events/${ids.event}/edit`,
    `/events/${ids.event}/candidates`,
    `/events/${ids.past_event}`,
    "/staff",
    "/staff/new",
    `/staff/${ids.staff}`,
    `/staff/${ids.staff}/edit`,
    "/availability",
    `/availability/${ids.staff}`,
    "/results",
    "/analysis",
    "/analysis?by=venue&range=12m",
    "/expenses",
    "/sales",
    "/sales?kind=partner",
    "/sales?kind=partner&view=kanban",
    "/sales/new",
    `/sales/${ids.company}`,
    `/sales/${ids.company}/edit`,
    "/venues",
    "/venues/new",
    `/venues/${ids.venue}`,
    `/venues/${ids.venue}/edit`,
    "/more",
    "/settings",
    "/settings/users",
    "/settings/masters/roles",
    "/settings/masters/items",
    "/settings/masters/ranks",
    "/settings/masters/areas",
    "/settings/templates",
    "/settings/general",
    "/import",
    "/audit",
    `/m/${ids.token}`,
    `/m/${ids.token}/schedule`,
    `/m/${ids.token}/report`,
    ...(ids.assignment ? [`/m/${ids.token}/report/${ids.assignment}`] : []),
    `/m/${ids.token}/availability`,
    `/m/${ids.token}/history`,
  ];
  for (const p of pages) {
    const res = await page.goto(p);
    expect(res?.status(), p).toBeLessThan(400);
    await page.getByRole("main").first().waitFor();
    await expectNoHorizontalScroll(page);
  }
});
