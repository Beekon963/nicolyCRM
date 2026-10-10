import { expect, test, type Page } from "@playwright/test";
import { cleanupEvent, freeFutureDate, makeEvent, one, sql } from "../helpers/db";
import { expectNoHorizontalScroll } from "../helpers/layout";

/**
 * 稼働表（Phase 1.5）: 今のシートと同じ形で月全体を見渡し、マスから打診・確定・稼働可能日の入力ができる。
 */
test.describe("稼働表", () => {
  let date = "";
  let eventId = "";
  let staff: { id: string; name: string };

  test.beforeEach(async () => {
    date = await freeFutureDate();
    const ev = await makeEvent(`'${date}'::date`, { required: 1 });
    eventId = ev.id;
    staff = await one(
      `select s.id, s.name from staff s join staff_roles sr on sr.staff_id = s.id
        where s.status = 'active' and sr.role_id = $1
          and not exists (select 1 from staff_ng n where n.staff_id = s.id)
          and not exists (select 1 from assignments a join events e on e.id = a.event_id where a.staff_id = s.id and e.date = $2)
          and (select count(*) from staff x where x.name = s.name) = 1
        order by random() limit 1`,
      [ev.roleId, date],
    );
    await sql(`delete from availability where staff_id = $1 and date = $2`, [staff.id, date]);
  });

  test.afterEach(async () => {
    await cleanupEvent(eventId);
    await sql(`delete from availability where staff_id = $1 and date = $2`, [staff.id, date]);
  });

  async function openCell(page: Page) {
    await page.goto(`/events/board?month=${date.slice(0, 7)}`);
    await expect(page.getByRole("region", { name: /稼働表/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByRole("button", { name: `${staff.name} ${Number(date.slice(8))}日`, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: new RegExp(`^${staff.name}`) })).toBeVisible();
    return dialog;
  }

  test("マスから確定すると緑で入り、「元に戻す」で消える", async ({ page }) => {
    const dialog = await openCell(page);
    const row = dialog.getByRole("listitem").filter({ has: page.locator(`a[href="/events/${eventId}"]`) });
    await row.getByRole("button", { name: "確定にする" }).click();
    await expect(dialog.getByRole("status")).toContainText("確定にしました");
    await expect(row.getByText("確定", { exact: true })).toBeVisible();
    expect((await one<{ status: string }>(`select status from assignments where event_id = $1 and staff_id = $2`, [eventId, staff.id])).status).toBe("confirmed");

    // ダイアログの中の「元に戻す」（ダイアログを開いている間はトーストが押せないため）
    await dialog.getByRole("status").getByRole("button", { name: "元に戻す" }).click();
    await expect(dialog.getByRole("status")).toContainText("元に戻しました");
    await expect(row.getByRole("button", { name: "確定にする" })).toBeVisible();
    expect(await sql(`select 1 from assignments where event_id = $1 and staff_id = $2`, [eventId, staff.id])).toHaveLength(0);
  });

  test("マスから打診すると、その人のマイページURL入りの文面が出る（PC はコピーだけ）", async ({ page, isMobile }) => {
    const dialog = await openCell(page);
    await dialog.getByRole("listitem").filter({ has: page.locator(`a[href="/events/${eventId}"]`) }).getByRole("button", { name: "打診する（LINE）" }).click();
    const msg = page.getByRole("dialog", { name: "打診の文面を送る" });
    await expect(msg).toBeVisible();
    const token = (await one<{ t: string }>(`select mypage_token as t from staff where id = $1`, [staff.id])).t;
    await expect(msg.locator("pre")).toContainText(`/m/${token}`);
    await expect(msg.getByRole("button", { name: /コピー/ })).toBeVisible();
    if (isMobile) await expect(msg.getByRole("link", { name: /LINE/ })).toBeVisible();
    else await expect(msg.getByRole("link", { name: /LINE/ })).toHaveCount(0);
    expect((await one<{ status: string }>(`select status from assignments where event_id = $1 and staff_id = $2`, [eventId, staff.id])).status).toBe("offered");
  });

  test("マスから稼働可能日を代理入力すると、表に ○ が出る", async ({ page }) => {
    const dialog = await openCell(page);
    await dialog.getByRole("button", { name: /^○/ }).click();
    await expect(dialog.getByRole("status")).toContainText("稼働可能日を入れました");
    await expect(dialog.getByRole("button", { name: /^○/ })).toHaveAttribute("aria-pressed", "true");
    const av = await one<{ status: string; source: string }>(`select status, source from availability where staff_id = $1 and date = $2`, [staff.id, date]);
    expect(av).toEqual({ status: "ok", source: "admin" });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: `${staff.name} ${Number(date.slice(8))}日`, exact: true })).toHaveText("○");
  });

  test("上の段の空いたマスから、その日・その取引先で現場を作る画面へ進める", async ({ page }) => {
    const ev = await one<{ client_id: string; client: string }>(
      `select e.client_id, c.name as client from events e join companies c on c.id = e.client_id where e.id = $1`,
      [eventId],
    );
    await page.goto(`/events/board?month=${date.slice(0, 7)}`);
    const next = (await one<{ d: string }>(`select to_char($1::date + 1, 'YYYY-MM-DD') as d`, [date])).d;
    test.skip(next.slice(0, 7) !== date.slice(0, 7), "月末の翌日は別の月になるため");
    const busy = await sql(`select 1 from events where client_id = $1 and date = $2`, [ev.client_id, next]);
    test.skip(busy.length > 0, "翌日にも同じ取引先の現場があるため");
    await page.getByRole("button", { name: `${ev.client} ${Number(next.slice(8))}日`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/events/new\\?date=${next}&client=${ev.client_id}`));
    await expect(page.getByLabel("日付")).toHaveValue(next);
    await expect(page.getByLabel("取引先", { exact: true })).toHaveValue(ev.client_id);
  });
});

test.describe("稼働表の拡大・縮小", () => {
  test("＋ / − で表だけが大きさを変え、倍率を押すと 100% に戻る。画面全体は横にずれない", async ({ page }) => {
    await page.goto("/events/board");
    await page.evaluate(() => localStorage.removeItem("nicoly.board.zoom"));
    await page.reload();
    const grid = page.locator("[data-board-zoom]");
    await expect(grid).toHaveAttribute("data-board-zoom", "1");
    const before = (await page.locator("table").first().boundingBox())!.width;

    await page.getByRole("button", { name: "縮小" }).click();
    await page.getByRole("button", { name: "縮小" }).click();
    await expect(page.getByRole("button", { name: /表の倍率 75%/ })).toBeVisible();
    const after = (await page.locator("table").first().boundingBox())!.width;
    expect(after).toBeLessThan(before * 0.8);
    await expectNoHorizontalScroll(page);
    // ページの見出しの文字の大きさは変わらない
    await expect(page.getByRole("heading", { name: "稼働表" })).toHaveCSS("font-size", "20px");

    // この端末に覚えておく
    await page.reload();
    await expect(page.getByRole("button", { name: /表の倍率 75%/ })).toBeVisible();

    await page.getByRole("button", { name: /表の倍率/ }).click();
    await expect(grid).toHaveAttribute("data-board-zoom", "1");
    await page.getByRole("button", { name: "拡大" }).click();
    await expect(page.getByRole("button", { name: /表の倍率 110%/ })).toBeVisible();
    await page.getByRole("button", { name: /表の倍率/ }).click();
  });

  test("Ctrl を押しながらホイールで、表の中だけ拡大・縮小できる", async ({ page, isMobile }) => {
    test.skip(isMobile, "ホイールは PC だけ（スマホは2本指）");
    await page.goto("/events/board");
    await page.evaluate(() => localStorage.removeItem("nicoly.board.zoom"));
    await page.reload();
    const box = (await page.getByRole("region", { name: /稼働表/ }).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, 100);
    await page.keyboard.up("Control");
    await expect(page.getByRole("button", { name: /表の倍率 (?!100%)\d+%/ })).toBeVisible();
    await page.getByRole("button", { name: /表の倍率/ }).click();
  });

  test("全画面で表だけを大きく出し、閉じると元の画面に戻る", async ({ page }) => {
    await page.goto("/events/board");
    await page.getByRole("button", { name: "全画面" }).click();
    const region = page.getByRole("region", { name: /稼働表/ });
    const vp = page.viewportSize()!;
    await expect.poll(async () => (await region.boundingBox())!.height).toBeGreaterThan(vp.height * 0.75);
    await expect(page.getByRole("button", { name: "閉じる" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.getByRole("button", { name: "閉じる" }).click();
    await expect(page.getByRole("button", { name: "全画面" })).toBeVisible();
  });
});
