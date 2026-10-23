import { expect, type Page, test } from "@playwright/test";
import { cleanupEvent, dropClient, dropStaff, letters, makeClient, makeStaff, one, sql } from "../helpers/db";

/**
 * 案件の進み具合（Phase 21）: 案件の文を貼って作る → 候補を足す → 段階を進める → 合格で確定になる。
 * カンバン、ホームの「自分の番」、貼った文（面談の候補日・合否・人員変更）からの確認カード。
 * 架空の取引先・会場・スタッフを作って使い、最後に消す。
 */
test.describe.configure({ mode: "serial" });

const tag = letters(5);
let client: { id: string; name: string };
let staff: { id: string; name: string };
let staff2: { id: string; name: string };
let venueId = "";
const venueName = `案件会場${tag}`;
const newVenueName = `案件新会場${tag}`;
const blockVenueName = `案件店舗${tag}`;
let month = "";
let m = 0;
let jobId = "";
let eventIds: string[] = [];

const surname = (name: string) => name.split(" ")[0];

function offerText() {
  return [`${m}月分お願いします`, "", `3 ${venueName}　1名`, `4 ${venueName}　2名`, `5 ${newVenueName}　1名`, "", "単価", "20000円/日　交通費込", "", "稼働時間", "10:00〜18:00", "", "備考", "外販経験者"].join("\n");
}

test.beforeAll(async () => {
  const d = await one<{ month: string; m: number }>(`select to_char(date_trunc('month', public.jst_today()) + interval '1 month', 'YYYY-MM') as month, extract(month from (date_trunc('month', public.jst_today()) + interval '1 month'))::int as m`);
  month = d.month;
  m = d.m;
  client = await makeClient("E2E案件取引先");
  staff = await makeStaff(`案件${tag} 太郎`);
  staff2 = await makeStaff(`交代${tag} 次郎`);
  venueId = (await one<{ id: string }>(`insert into venues (name) values ($1) returning id`, [venueName])).id;
});

test.afterAll(async () => {
  const evs = await sql<{ id: string }>(`select id from events where client_id = $1`, [client.id]);
  for (const e of evs) await cleanupEvent(e.id);
  await sql(`delete from group_candidates where group_id in (select id from event_groups where client_id = $1)`, [client.id]);
  await sql(`delete from event_group_private where group_id in (select id from event_groups where client_id = $1)`, [client.id]);
  await sql(`delete from event_groups where client_id = $1`, [client.id]);
  await dropStaff(staff.id, staff2.id);
  await sql(`delete from venues where name = any($1)`, [[venueName, newVenueName, blockVenueName]]);
  await dropClient(client.id);
});

async function openJob(page: Page) {
  await page.goto(`/jobs/${jobId}`);
  await expect(page.getByTestId("job-detail")).toBeVisible();
}

test("案件の文を貼ると日程・会場・単価を読み取り、案件と現場をまとめて作れる", async ({ page }) => {
  await page.goto("/jobs/new");
  await page.getByLabel("取引先の案件の文を貼ってください").fill(offerText());
  const read = page.getByRole("region", { name: "読み取った内容" });
  await expect(read).toContainText("3件");
  await expect(read).toContainText("20,000円/日（交通費込）");
  await expect(read).toContainText("10:00〜18:00");
  // 会場: ある会場はそのまま、ない会場は「この名前で新しく作る」
  const venueSec = page.getByRole("region", { name: "会場" });
  await expect(venueSec.getByLabel(`${venueName}の会場`)).toHaveValue(venueId);
  await expect(venueSec.getByLabel(`${newVenueName}の会場`)).toHaveValue("new");
  await page.getByLabel("取引先", { exact: true }).selectOption(client.id);
  await expect(page.getByLabel("案件の名前")).toHaveValue(`${m}月の案件`);
  await page.getByRole("button", { name: "案件と現場を作る（現場 3件）" }).click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  jobId = page.url().split("/").pop()!;
  await expect(page.getByTestId("job-events").getByRole("listitem")).toHaveCount(3);
  // DB: 現場・必要人数・単価（オーナー）・新しい会場
  const evs = await sql<{ id: string; required: number; rate: number | null; venue: string }>(
    `select e.id, (select required_count from event_requirements r where r.event_id = e.id) as required, (select amount from event_rates x where x.event_id = e.id) as rate, v.name as venue
       from events e join venues v on v.id = e.venue_id where e.group_id = $1 order by e.date`,
    [jobId],
  );
  eventIds = evs.map((e) => e.id);
  expect(evs.map((e) => e.required)).toEqual([1, 2, 1]);
  expect(evs.every((e) => e.rate === 20000)).toBe(true);
  expect(evs[2].venue).toBe(newVenueName);
  await expect(page.getByTestId("job-rate")).toContainText("20,000円/日（交通費込）");
});

/** 見出しごとに分かれた書き方（■ 日程 / ■ エントリー期限 / ■ 店舗 ①② / 単価の行 / ・店名 →N名 ＋【日程】） */
function blockText() {
  return [
    "お世話になっております。",
    "",
    "■ 日程",
    `${m}/1〜${m}/3予定`,
    "",
    "■ エントリー期限",
    `⚠️${m}/1まで⚠️`,
    "",
    "■ 店舗",
    `① ${venueName}`,
    `② ${blockVenueName}`,
    "",
    "弱　30,000円",
    "一律 24,000円",
    "",
    `・${venueName}　→2名`,
    `【日程】${m}/2・${m}/3`,
    `・${blockVenueName}　→3名`,
    "※家電販売可能な方優先",
  ].join("\n");
}

test("見出しごとに分かれた書き方の文も、全体の日程・期限・店舗ごとの日程と人数・単価のメモに分けて読み、表で直してから作れる", async ({ page }) => {
  await page.goto("/jobs/new");
  await page.getByLabel("取引先の案件の文を貼ってください").fill(blockText());
  const read = page.getByRole("region", { name: "読み取った内容" });
  await expect(read).toContainText("2件（日程あり 2件）");
  await expect(read).toContainText("現場 5件");
  await expect(read).toContainText("エントリー期限");
  await expect(read).toContainText("24,000円/日");
  await expect(read).toContainText("※家電販売可能な方優先");
  // 店舗の表: ① は店舗ごとの日程（2日）と 2名、② は全体の日程（3日）と 3名
  await expect(page.getByLabel("全体の日程（店舗に日程が書いてないときに使う）")).toHaveValue(`${m}/1〜${m}/3`);
  const rows = page.getByTestId("job-venue-row");
  await expect(rows).toHaveCount(2);
  await expect(page.getByLabel(`${venueName}の日程`)).toHaveValue(`${m}/2・${m}/3`);
  await expect(page.getByLabel(`${venueName}の人数`)).toHaveValue("2");
  await expect(page.getByLabel(`${blockVenueName}の日程`)).toHaveValue("");
  await expect(page.getByLabel(`${blockVenueName}の人数`)).toHaveValue("3");
  await expect(page.getByLabel("エントリー期限（取引先に返事をする期限）")).toHaveValue(`${month}-01`);
  await expect(page.getByLabel("単価（請求の人日単価・円。オーナーだけ）")).toHaveValue("24000");
  await expect(page.getByLabel("単価のメモ（文の中の金額の行。オーナーだけ）")).toHaveValue("弱 30,000円\n一律 24,000円");
  await expect(page.getByLabel("備考（募集の条件など）")).toHaveValue("※家電販売可能な方優先");
  // 全体の日程を直すと、② の現場が変わる（3日 → 2日）
  await page.getByLabel("全体の日程（店舗に日程が書いてないときに使う）").fill(`${m}/1・${m}/2`);
  await expect(page.getByRole("button", { name: "案件と現場を作る（現場 4件）" })).toBeVisible();
  await page.getByLabel("取引先", { exact: true }).selectOption(client.id);
  await expect(page.getByLabel("案件の名前")).toHaveValue(`${m}月の案件`);
  await page.getByRole("button", { name: "案件と現場を作る（現場 4件）" }).click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  const id = page.url().split("/").pop()!;
  await expect(page.getByTestId("job-events").getByRole("listitem")).toHaveCount(4);
  await expect(page.getByTestId("job-deadline")).toContainText("エントリー期限");
  await expect(page.getByTestId("job-rate")).toContainText("24,000円/日");
  await expect(page.getByTestId("job-rate-note")).toContainText("一律 24,000円");
  // DB: 店舗ごとの日程と人数、期限、単価のメモ（オーナーだけのテーブル）
  const evs = await sql<{ date: string; venue: string; required: number }>(
    `select to_char(e.date, 'MM-DD') as date, v.name as venue, (select required_count from event_requirements r where r.event_id = e.id) as required
       from events e join venues v on v.id = e.venue_id where e.group_id = $1 order by e.date, v.name`,
    [id],
  );
  const mm = String(m).padStart(2, "0");
  const key = (x: { date: string; venue: string }) => `${x.date}|${x.venue}`;
  const byKey = (a: { date: string; venue: string }, b: { date: string; venue: string }) => (key(a) < key(b) ? -1 : 1);
  expect([...evs].sort(byKey)).toEqual(
    [
      { date: `${mm}-01`, venue: blockVenueName, required: 3 },
      { date: `${mm}-02`, venue: blockVenueName, required: 3 },
      { date: `${mm}-02`, venue: venueName, required: 2 },
      { date: `${mm}-03`, venue: venueName, required: 2 },
    ].sort(byKey),
  );
  const g = await one<{ deadline: string; note: string; rate: number }>(
    `select to_char(g.entry_deadline, 'YYYY-MM-DD') as deadline, p.rate_note as note, p.rate from event_groups g join event_group_private p on p.group_id = g.id where g.id = $1`,
    [id],
  );
  expect(g).toEqual({ deadline: `${month}-01`, note: "弱 30,000円\n一律 24,000円", rate: 24000 });
  // あとのテストの邪魔にならないように終わった案件にしておく
  await sql(`update event_groups set closed_at = now() where id = $1`, [id]);
});

test("候補を足して日程に入れ、段階を進める。合格にすると打診中の予定が確定になる", async ({ page }) => {
  test.setTimeout(120_000);
  await openJob(page);
  await page.getByRole("button", { name: "候補を足す" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("スタッフを探す").fill(tag);
  await dialog.getByLabel(staff.name).check();
  await dialog.getByRole("button", { name: "1人を足す" }).click();
  const cand = page.getByTestId("job-candidate").filter({ hasText: staff.name });
  await expect(cand).toBeVisible();
  await expect(cand).toHaveAttribute("data-stage", "candidate");

  // 日程に入れる（3日分を打診中に）
  await cand.getByRole("button", { name: "日程に入れる" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "3日分を打診中にする" }).click();
  await expect(cand.getByText("打診中")).toHaveCount(3);

  // 本人OK → スキルシート提出済（候補日のお願いの文が出せる）→ 候補日あり → 候補日送付済 → 面談日時共有済 → 面談済
  const next = async (label: string) => {
    await cand.getByRole("button", { name: `次へ: ${label}` }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: `${label}にする` }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  };
  await next("本人OK");
  await expect(cand).toHaveAttribute("data-stage", "staff_ok");
  await next("スキルシート提出済");
  await cand.getByRole("button", { name: "面談の候補日時のお願いの文" }).click();
  await expect(page.getByRole("dialog").getByLabel("本人へ: 面談の候補日時のお願い")).toHaveValue(new RegExp(`${staff.name}さん`));
  await page.keyboard.press("Escape");
  await cand.getByRole("button", { name: "次へ: 候補日あり" }).click();
  await page.getByRole("dialog").getByLabel("本人からの候補の日時（1行に1つ）").fill("10/26 20:00〜\n10/27 9:00〜12:00\n10/28 終日");
  await page.getByRole("dialog").getByRole("button", { name: "候補日ありにする" }).click();
  await expect(cand).toContainText("10/27 9:00〜12:00");
  // 取引先へのまとめ文（候補日時のある人の分）
  await page.getByRole("button", { name: "取引先へのまとめ文" }).click();
  await expect(page.getByRole("dialog").getByLabel("取引先へのまとめ文")).toHaveValue(new RegExp(`${staff.name}\\n10/26 20:00〜`));
  await page.keyboard.press("Escape");
  await next("候補日送付済");
  await cand.getByRole("button", { name: "次へ: 面談日時共有済" }).click();
  await page.getByRole("dialog").getByLabel("面談の日時").fill(`${month}-01T15:30`);
  await page.getByRole("dialog").getByLabel("リンク・場所など").fill("https://example.com/meet");
  await page.getByRole("dialog").getByRole("button", { name: "面談日時共有済にする" }).click();
  await expect(cand).toContainText("15:30");
  await cand.getByRole("button", { name: "面談の日時の共有の文" }).click();
  await expect(page.getByRole("dialog").getByLabel("本人へ: 面談の日時の共有")).toHaveValue(/15:30〜 です/);
  await page.keyboard.press("Escape");
  await next("面談済");
  await expect(cand).toHaveAttribute("data-stage", "interviewed");

  // 合格 → 打診中の3日分が確定になる
  await cand.getByRole("button", { name: "合格", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "合格にする" }).click();
  await expect(page.getByRole("region", { name: /Notifications/ }).getByText(/打診中の 3日分を確定にしました/)).toBeVisible();
  await expect(cand).toHaveAttribute("data-stage", "passed");
  const n = await one<{ n: number }>(`select count(*)::int as n from assignments where staff_id = $1 and status = 'confirmed' and event_id = any($2)`, [staff.id, eventIds]);
  expect(n.n).toBe(3);
});

test("一覧のカードとカンバンに出る。PC ではカンバンで札を動かして段階を変えられる（元に戻せる）", async ({ page, isMobile }) => {
  await page.goto("/jobs");
  const card = page.getByTestId("job-card").filter({ hasText: client.name }).filter({ hasText: staff.name });
  await expect(card).toBeVisible();
  await expect(card).toContainText(staff.name);
  await page.goto("/jobs?view=kanban");
  const passed = page.getByRole("region", { name: "合格", exact: true });
  await expect(passed.getByTestId("kanban-card").filter({ hasText: staff.name })).toBeVisible();
  if (isMobile) return;
  const cardEl = passed.getByTestId("kanban-card").filter({ hasText: staff.name });
  await cardEl.dragTo(page.getByRole("region", { name: "候補", exact: true }));
  await expect(page.getByRole("region", { name: /Notifications/ }).getByText(/「候補」にしました/)).toBeVisible();
  await expect(page.getByRole("region", { name: "候補", exact: true }).getByTestId("kanban-card").filter({ hasText: staff.name })).toBeVisible();
  // ホームに「案件で自分の番」が出る
  await page.goto("/");
  await expect(page.getByTestId("home-jobs")).toBeVisible();
  // 戻しておく（確定した予定はそのまま）
  await sql(`update group_candidates set stage = 'passed' where group_id = $1 and staff_id = $2`, [jobId, staff.id]);
});

test("貼った文から: 面談の候補日 → 確認カード、合否 → 確認カード、人員変更 → 確認カード（PC）", async ({ page, isMobile }) => {
  test.skip(isMobile, "読み取りは同じ仕組みなので PC で確かめる");
  test.setTimeout(120_000);
  // 段階を戻して、候補日時の返事が入る状態に
  await sql(`update group_candidates set stage = 'sheet_sent', interview_slots = '' where group_id = $1 and staff_id = $2`, [jobId, staff.id]);
  await page.goto("/inbox");
  const inbox = page.getByTestId("inbox");
  const paste = async (text: string) => {
    await inbox.getByRole("textbox").first().fill(text);
    await inbox.getByRole("button", { name: "読み取る" }).click();
    await expect(page.getByTestId("inbox-result")).toBeVisible();
  };
  await paste("10/26 20:00〜\n10/27 9:00〜12:00");
  await expect(page.getByTestId("inbox-result")).toHaveAttribute("data-kind", "slots");
  const candOption = page.getByLabel("だれの候補日時か").locator("option", { hasText: staff.name });
  await page.getByLabel("だれの候補日時か").selectOption((await candOption.getAttribute("value")) ?? "");
  await page.getByRole("button", { name: "確認カードを出す" }).click();
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByText(/候補日時を入れました/)).toBeVisible();
  const c1 = await one<{ stage: string; slots: string }>(`select stage, interview_slots as slots from group_candidates where group_id = $1 and staff_id = $2`, [jobId, staff.id]);
  expect(c1.stage).toBe("slots_collected");
  expect(c1.slots).toContain("10/27 9:00〜12:00");

  // 合否（名字で人を当てる。案件は候補にいる案件が1つなので自動）
  await inbox.getByRole("button", { name: "消す" }).click();
  await paste(`お世話になっております。\n${surname(staff.name)}さん合格です！`);
  await expect(page.getByTestId("inbox-result")).toHaveAttribute("data-kind", "result");
  await expect(page.getByLabel("どの案件の合否か")).toHaveValue(jobId);
  await page.getByRole("button", { name: "確認カードを出す" }).click();
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByText(/合否を入れました: 合格 1人/)).toBeVisible();
  const c2 = await one<{ stage: string }>(`select stage from group_candidates where group_id = $1 and staff_id = $2`, [jobId, staff.id]);
  expect(c2.stage).toBe("passed");

  // 人員変更: 3日の現場で 太郎 が欠員 → 次郎 を確定に
  await inbox.getByRole("button", { name: "消す" }).click();
  await paste(`${m}月3日の${venueName} ${surname(staff.name)}欠員のため人員変更。\n\n${venueName} ${surname(staff2.name)}`);
  await expect(page.getByTestId("inbox-result")).toHaveAttribute("data-kind", "reassign");
  await expect(page.getByLabel(`${surname(staff.name)}はだれか`)).toHaveValue(staff.id);
  await expect(page.getByLabel(`${surname(staff2.name)}はだれか`)).toHaveValue(staff2.id);
  await page.getByRole("button", { name: "確認カードを出す" }).click();
  await expect(page.getByText(`${staff2.name} を確定にする`)).toBeVisible();
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByText(/人員変更を入れました: 確定 1人・キャンセル 1人/)).toBeVisible();
  const rows = await sql<{ staff_id: string; status: string }>(`select staff_id, status from assignments where event_id = $1 order by status`, [eventIds[0]]);
  expect(rows.find((r) => r.staff_id === staff.id)?.status).toBe("cancelled");
  expect(rows.find((r) => r.staff_id === staff2.id)?.status).toBe("confirmed");
});

test("管理者も案件を見られるが、単価は出ない", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "e2e/.auth/manager.json" });
  const page = await ctx.newPage();
  await page.goto(`/jobs/${jobId}`);
  await expect(page.getByTestId("job-detail")).toBeVisible();
  await expect(page.getByTestId("job-rate")).toHaveCount(0);
  await expect(page.getByTestId("job-detail")).not.toContainText("円");
  await ctx.close();
});
