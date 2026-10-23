import { expect, test } from "@playwright/test";
import { cleanupEvent, dropStaff, freeFutureDate, makeEvent, makeStaff, one, sql } from "../helpers/db";
import { expectNoHorizontalScroll } from "../helpers/layout";

/**
 * 「LINE の文を貼るだけ」（Phase 18）。件数の報告・稼働可能日・打診の返事・募集の文・案件詳細を貼って、確認カードから登録する。
 * 人はくじ引きで選ばず makeStaff で作る。
 */
let staff: { id: string; name: string };
let pastEventId = "";
let futureEventId = "";
let offerId = "";
let venue = "";
let itemName = "";

test.beforeAll(async () => {
  staff = await makeStaff("貼付 太郎");
  // 昨日の現場（確定）に報告を貼る
  const past = await makeEvent("public.jst_today() - 1", { required: 1 });
  pastEventId = past.id;
  venue = past.venue;
  await sql(`insert into assignments (event_id, staff_id, role_id, status, responded_at, response_source) values ($1, $2, $3, 'confirmed', now(), 'admin')`, [past.id, staff.id, past.roleId]);
  // 先の現場に打診中（返事を貼る）
  const future = await makeEvent(`'${await freeFutureDate()}'::date`, { required: 1 });
  futureEventId = future.id;
  offerId = (await one<{ id: string }>(`insert into assignments (event_id, staff_id, role_id, status, offered_at) values ($1, $2, $3, 'offered', now()) returning id`, [future.id, staff.id, future.roleId])).id;
  itemName = (await one<{ name: string }>(`select name from items where is_active order by sort_order limit 1`)).name;
});

test.afterAll(async () => {
  await cleanupEvent(pastEventId);
  await cleanupEvent(futureEventId);
  await dropStaff(staff.id);
});

test("件数の報告を貼ると速報の確認カードが出て、登録すると報告が入る。横にずれない", async ({ page }) => {
  await page.goto("/inbox");
  await expectNoHorizontalScroll(page);
  const yesterday = await one<{ d: string }>(`select to_char(public.jst_today() - 1, 'FMMM/FMDD') as d`);
  await page.getByRole("textbox").fill(`${yesterday.d} ${venue}\n${itemName}2\n所感: 午後から混みました`);
  await page.getByRole("button", { name: "読み取る" }).click();
  const result = page.getByTestId("inbox-result");
  await expect(result).toHaveAttribute("data-kind", "report");
  const card = page.getByTestId("ai-card");
  await expect(card).toContainText(staff.name);
  await expect(card).toContainText(`${itemName} 2`);
  await card.getByRole("button", { name: "登録する" }).click();
  await expect(card).toContainText("報告を入れました");
  const r = await one<{ n: number; comment: string }>(
    `select coalesce(sum(ri.reported_count), 0)::int as n, r.comment from reports r left join report_items ri on ri.assignment_id = r.assignment_id where r.assignment_id = (select id from assignments where event_id = $1 and staff_id = $2) group by r.comment`,
    [pastEventId, staff.id],
  );
  expect(r.n).toBe(2);
  expect(r.comment).toContain("午後から混みました");
});

test("稼働可能日を貼り、だれの分か選ぶと確認カードが出て、登録すると入る", async ({ page }) => {
  await page.goto("/inbox");
  const month = await one<{ m: string; mm: number }>(`select to_char(date_trunc('month', public.jst_today()) + interval '1 month', 'YYYY-MM') as m, extract(month from date_trunc('month', public.jst_today()) + interval '1 month')::int as mm`);
  await page.getByRole("textbox").fill(`${month.mm}月\n1,2 ○\n3 △\n他は×`);
  await page.getByRole("button", { name: "読み取る" }).click();
  const result = page.getByTestId("inbox-result");
  await expect(result).toHaveAttribute("data-kind", "availability");
  await expect(result).toContainText("○ 1・2日");
  await result.getByLabel("だれの稼働可能日か").selectOption(staff.id);
  await result.getByRole("button", { name: "確認カードを出す" }).click();
  const card = page.getByTestId("ai-card");
  await expect(card).toContainText(staff.name);
  await card.getByRole("button", { name: "登録する" }).click();
  await expect(card).toContainText("入れました");
  const rows = await sql<{ status: string; n: number }>(`select status, count(*)::int as n from availability where staff_id = $1 and date >= ($2 || '-01')::date and date < ($2 || '-01')::date + interval '1 month' group by status order by status`, [staff.id, month.m]);
  expect(rows.find((r) => r.status === "ok")?.n).toBe(2);
  expect(rows.find((r) => r.status === "maybe")?.n).toBe(1);
  expect(rows.find((r) => r.status === "ng")?.n).toBeGreaterThanOrEqual(25);
});

test("打診の返事を貼ると返事待ちの一覧が出て、1タップで確定になる（元に戻せる）", async ({ page }) => {
  await page.goto("/inbox");
  await page.getByRole("textbox").fill("参加できます！よろしくお願いします");
  await page.getByRole("button", { name: "読み取る" }).click();
  const result = page.getByTestId("inbox-result");
  await expect(result).toHaveAttribute("data-kind", "reply");
  await result.getByRole("button", { name: `${staff.name}さんを確定にする` }).click();
  await expect(page.getByText(`${staff.name}さんを確定にしました`)).toBeVisible();
  expect((await one<{ status: string }>(`select status from assignments where id = $1`, [offerId])).status).toBe("confirmed");
  await page.getByRole("button", { name: "元に戻す" }).click();
  await expect.poll(async () => (await one<{ status: string }>(`select status from assignments where id = $1`, [offerId])).status).toBe("offered");
});

test("募集の文は「現場を作る」画面へ、案件詳細は会場のメモへ、読めない文は AI へ", async ({ page }) => {
  await page.goto("/inbox");
  const box = page.getByRole("textbox");
  await box.fill("〈募集日〉\n12/1・5・6\n■稼働場所\nE2E貼付モール\n■時間\n10:00-19:00\n募集：クローザー1名");
  await page.getByRole("button", { name: "読み取る" }).click();
  await expect(page.getByTestId("inbox-result")).toHaveAttribute("data-kind", "recruit");
  await page.getByRole("link", { name: "現場を作る画面で続ける" }).click();
  await expect(page).toHaveURL(/\/events\/from-text\?text=/);
  await expect(page.getByRole("textbox", { name: "取引先の募集の文を貼ってください" })).toHaveValue(/E2E貼付モール/);

  await page.goto("/inbox");
  await page.getByRole("textbox").fill(`【案件詳細】\n●開催場所\n${venue}\n●集合場所\n1F 正面入口\n●服装\nスーツ`);
  await page.getByRole("button", { name: "読み取る" }).click();
  const details = page.getByTestId("inbox-result");
  await expect(details).toHaveAttribute("data-kind", "details");
  await details.getByRole("button", { name: "会場のメモに入れる" }).click();
  // 同じ会場で先に（別の端末のテストが）入れていれば「もう入っています」
  await expect(details).toContainText(/のメモに(入れました|もう入っています)/);
  const memo = await one<{ memo: string }>(`select memo from venues where name = $1`, [venue]);
  expect(memo.memo).toContain("1F 正面入口");
  await sql(`update venues set memo = trim(regexp_replace(memo, '\\n*【LINE の現場詳細[\\s\\S]*$', '')) where name = $1`, [venue]);

  await page.goto("/inbox");
  await page.getByRole("textbox").fill("来週の打ち合わせの件ですが、資料をお送りします");
  await page.getByRole("button", { name: "読み取る" }).click();
  await expect(page.getByTestId("inbox-result")).toHaveAttribute("data-kind", "unknown");
  await page.getByRole("button", { name: "AI に読んでもらう" }).click();
  await expect(page.getByRole("dialog", { name: "AI アシスタント" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "AI アシスタント" })).toContainText("来週の打ち合わせの件");
});
