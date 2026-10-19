import { expect, test } from "@playwright/test";
import { cleanupEvent, dropClient, dropStaff, makeClient, makeEvent, makeStaff, one, sql } from "../helpers/db";
import { expectNoHorizontalScroll } from "../helpers/layout";

/**
 * Phase 8-7: 稼働開始の報告（NextWave のルール「稼働開始時は、現場名と稼働者名を記載し、『稼働します』と報告」）。
 * 取引先の書式に「稼働開始の報告」があると、稼働日の当日にマイページの「予定」と「報告」に、
 * 現場名・稼働者（同じ現場の全員）・稼働します の文が出て、コピーできる
 */
const tag = Math.random().toString(36).slice(2, 6);
const FORMAT = `E2E稼働開始${tag}`;
let eventId = "";
let venue = "";
let staff: { id: string; name: string; token: string }[] = [];
let assignmentId = "";
let clientId = "";

test.beforeAll(async () => {
  // 取引先と人はこのテストで作る（「稼働開始の報告」の書式を、ほかのテストの現場に付けないため）
  const client = await makeClient("E2E稼働開始先");
  clientId = client.id;
  const ev = await makeEvent("jst_today()", { required: 2, clientId });
  eventId = ev.id;
  venue = ev.venue;
  staff = [await makeStaff("開始 一郎"), await makeStaff("開始 二郎")];
  assignmentId = (await one<{ id: string }>(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed') returning id`, [eventId, staff[0].id, ev.roleId])).id;
  await sql(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed')`, [eventId, staff[1].id, ev.roleId]);
  await sql(`insert into report_formats (name, company_id, for_staff, event_block, start_block) values ($1, $2, true, '{会場}', E'{会場}\\n稼働者：{稼働者}\\n稼働します')`, [FORMAT, client.id]);
});

test.afterAll(async () => {
  await sql(`delete from report_formats where name = $1`, [FORMAT]);
  await cleanupEvent(eventId);
  await dropStaff(...staff.map((s) => s.id));
  await dropClient(clientId);
});

test("当日の予定に「稼働します」の報告が出て、2人の現場は全員の名前が入る", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`/m/${staff[0].token}/schedule`);
  const card = page.getByRole("region", { name: "現場に着いたら（稼働開始の報告）" });
  await expect(card).toContainText(venue);
  await expect(card).toContainText(staff[0].name);
  await expect(card).toContainText(staff[1].name);
  await expect(card).toContainText("稼働します");
  await expect(card).toContainText("代表の1人が送ってください");
  await expect(card.getByRole("button", { name: "コピー" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  // 報告の画面にも出る
  await page.goto(`/m/${staff[0].token}/report/${assignmentId}`);
  await expect(page.getByRole("region", { name: "現場に着いたら（稼働開始の報告）" })).toContainText("稼働します");
  await ctx.close();
});
