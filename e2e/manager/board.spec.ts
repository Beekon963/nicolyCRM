import { expect, test, type Page } from "@playwright/test";
import { cleanupEvent, dropStaff, freeFutureDate, makeEvent, makeStaff, one, sql } from "../helpers/db";
import { expectNoHorizontalScroll } from "../helpers/layout";

/**
 * 稼働表（Phase 1.5）: 今のシートと同じ形で月全体を見渡し、マスから打診・確定・稼働可能日の入力ができる。
 * スマホは最初は日ごとのリスト（Phase 10）なので、ここでは表を選んだ状態で確かめる（リストは board-view.spec.ts）
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("nicoly.board.view", '"table"'));
});

test.describe("稼働表", () => {
  let date = "";
  let eventId = "";
  let venue = "";
  let roleId = "";
  let staff: { id: string; name: string };
  let clientId = "";

  test.beforeEach(async () => {
    date = await freeFutureDate();
    const ev = await makeEvent(`'${date}'::date`, { required: 1 });
    eventId = ev.id;
    // 取引先はこのテストだけのもの（マスに出す現場は1件なので、ほかのテストの現場と同じ日だと隠れることがある）
    clientId = (await one<{ id: string }>(`insert into companies (kind, name, status) values ('client', $1, 'active') returning id`, [`E2E稼働表${Math.random().toString(36).slice(2, 8)}`])).id;
    await sql(`update events set client_id = $1 where id = $2`, [clientId, eventId]);
    venue = ev.venue;
    roleId = ev.roleId;
    // 人はこのテストで作る（ほかのテストと同じ人を取り合わないように）
    staff = await makeStaff("稼働表 一郎");
  });

  test.afterEach(async () => {
    await cleanupEvent(eventId);
    await sql(`delete from companies where id = $1`, [clientId]);
    await dropStaff(staff.id);
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

  test("キャンセルになった人のマスと、欠員のある現場はマスごと赤く塗る。そろった現場は会場の色", async ({ page }) => {
    // 確定 → キャンセルの「変更」はお知らせ（ポップアップ）が出てほかのテストの邪魔になるので、最初からキャンセルで入れる
    await sql(`insert into assignments (event_id, staff_id, role_id, status, cancel_reason_code) values ($1, $2, $3, 'cancelled', 'self')`, [eventId, staff.id, roleId]);
    await page.goto(`/events/board?month=${date.slice(0, 7)}`);
    const day = Number(date.slice(8));
    const staffCell = page.getByRole("button", { name: `${staff.name} ${day}日`, exact: true });
    const dropped = staffCell.locator('[data-tile="cancelled"]');
    await expect(dropped).toContainText("キャンセル");
    await expect(dropped).toHaveCSS("background-color", "rgb(217, 45, 32)");
    const client = await one<{ name: string }>(`select c.name from events e join companies c on c.id = e.client_id where e.id = $1`, [eventId]);
    const clientCell = page.getByRole("button", { name: `${client.name} ${day}日`, exact: true });
    const shortage = clientCell.locator('[data-tile="shortage"]', { hasText: venue });
    await expect(shortage).toHaveCSS("background-color", "rgb(217, 45, 32)");
    await expect(shortage).toContainText("欠1");
    await expect(page.getByTestId("board-gauge")).toBeVisible();

    // 別の人を確定にすると、現場のマスは会場の色に変わる
    const other = await makeStaff("稼働表 二郎");
    try {
      await sql(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed')`, [eventId, other.id, roleId]);
      await page.reload();
      const filled = clientCell.locator('[data-tile="filled"]', { hasText: venue });
      await expect(filled).toBeVisible();
      await expect(filled).not.toHaveCSS("background-color", "rgb(217, 45, 32)");
    } finally {
      await dropStaff(other.id);
    }
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
    const next = (await one<{ d: string }>(`select to_char($1::date + 1, 'YYYY-MM-DD') as d`, [date])).d;
    test.skip(next.slice(0, 7) !== date.slice(0, 7), "月末の翌日は別の月になるため");
    // このテストだけの取引先を作る（ほかのテストが同じ取引先・同じ日に現場を作って消すと、空いたマスでなくなるため）
    const name = `E2E空きマス${Math.random().toString(36).slice(2, 6)}`;
    const client = await one<{ id: string }>(`insert into companies (kind, name, status) values ('client', $1, 'active') returning id`, [name]);
    const own = await one<{ id: string }>(`insert into events (client_id, venue_id, date) values ($1, (select id from venues limit 1), $2) returning id`, [client.id, date]);
    try {
      await page.goto(`/events/board?month=${date.slice(0, 7)}`);
      await page.getByRole("button", { name: `${name} ${Number(next.slice(8))}日`, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/events/new\\?date=${next}&client=${client.id}`));
      await expect(page.getByLabel("日付")).toHaveValue(next);
      await expect(page.getByLabel("取引先", { exact: true })).toHaveValue(client.id);
    } finally {
      await cleanupEvent(own.id);
      await sql(`delete from companies where id = $1`, [client.id]);
    }
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
    await expect(page.getByRole("heading", { name: "稼働表" })).toHaveCSS("font-size", "22px");

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

test.describe("稼働表をスプレッドシートのように使う（PC）", () => {
  test.skip(({ isMobile }) => isMobile, "キーボード・マウスの操作は PC で確かめる");
  let date = "";
  let staff: { id: string; name: string };

  test.beforeEach(async ({ page }) => {
    date = await freeFutureDate();
    // 2日先まで同じ月の表に入るように、月末は避ける
    if (Number(date.slice(8)) > 25) date = `${date.slice(0, 8)}20`;
    // 人はこのテストで作る（ほかのテストと同じ人の稼働可能日を取り合わないように）
    staff = await makeStaff("表操作 一郎");
    await page.goto(`/events/board?month=${date.slice(0, 7)}`);
    await page.evaluate(() => {
      localStorage.removeItem("nicoly.board.layout");
      localStorage.removeItem("nicoly.board.zoom");
    });
    await page.reload();
  });

  test.afterEach(async () => {
    if (staff) await dropStaff(staff.id);
  });

  /** マスを押して開いた画面を閉じる（そのマスが選ばれた状態になる） */
  async function selectCell(page: Page, d: string) {
    await page.getByRole("button", { name: `${staff.name} ${Number(d.slice(8))}日`, exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  }

  const avail = async () =>
    (await sql<{ d: string; status: string }>(`select to_char(date, 'YYYY-MM-DD') as d, status from availability where staff_id = $1 and date between $2::date and $2::date + 2 order by date`, [staff.id, date])).map(
      (r) => `${r.d.slice(8)}:${r.status}`,
    );

  test("1 2 3 で ○△× が入り、次の日に進む。元に戻せる。Delete で消せる", async ({ page }) => {
    await selectCell(page, date);
    await page.keyboard.press("1");
    await page.keyboard.press("2");
    await page.keyboard.press("3");
    const day = (n: number) => String(Number(date.slice(8)) + n).padStart(2, "0");
    await expect.poll(avail).toEqual([`${day(0)}:ok`, `${day(1)}:maybe`, `${day(2)}:ng`]);
    await expect(page.getByRole("button", { name: `${staff.name} ${Number(date.slice(8))}日`, exact: true })).toContainText("○");

    // 最後に入れた「×」を元に戻す（新しいお知らせが上に出る）
    await page.getByRole("button", { name: "元に戻す" }).first().click();
    await expect.poll(avail).toEqual([`${day(0)}:ok`, `${day(1)}:maybe`]);

    // 入れるたびに次の日へ進んでいるので、3日戻ってから3日分を選んで Delete
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Delete");
    await expect.poll(avail).toEqual([]);
  });

  test("選んだマスの行と列に色が付き、Shift＋矢印の範囲を Ctrl＋C でコピーできる", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await sql(`insert into availability (staff_id, date, status, source) values ($1, $2, 'ok', 'admin'), ($1, $2::date + 1, 'ng', 'admin')`, [staff.id, date]);
    await page.reload();
    await selectCell(page, date);
    const cell = page.locator("td", { has: page.getByRole("button", { name: `${staff.name} ${Number(date.slice(8))}日`, exact: true }) });
    await expect(cell).toHaveCSS("outline-style", "solid");
    // 日付の見出しと名前が太字で強調される
    const head = page.locator("thead th", { hasText: new RegExp(`^${Number(date.slice(8))}`) }).first();
    await expect(head).toHaveCSS("font-weight", "700");

    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("ControlOrMeta+c");
    await expect(page.getByText("コピーしました（1行 × 2列）")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("○\t×");

    // Esc で選択を外す
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(cell).not.toHaveCSS("outline-style", "solid");
  });

  test("日付の列の幅をドラッグで変え、行の高さを切り替えられる（端末に覚える）", async ({ page }) => {
    const th = page.locator("thead th").nth(1);
    const before = (await th.boundingBox())!.width;
    const handle = th.getByRole("separator", { name: "日付の列の幅を変える" });
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 - 40, hb.y + hb.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await th.boundingBox())!.width).toBeLessThan(before - 30);

    const row = page.locator("tbody tr", { has: page.getByRole("button", { name: `${staff.name} ${Number(date.slice(8))}日`, exact: true }) });
    const tall = (await row.boundingBox())!.height;
    await page.getByRole("button", { name: /行の高さ 中/ }).click();
    await expect(page.getByRole("button", { name: /行の高さ 小/ })).toBeVisible();
    await expect.poll(async () => (await row.boundingBox())!.height).toBeLessThan(tall);

    await page.reload();
    await expect(page.getByRole("button", { name: /行の高さ 小/ })).toBeVisible();
    expect((await page.locator("thead th").nth(1).boundingBox())!.width).toBeLessThan(before - 30);

    // 元に戻す（ダブルクリックで元の幅、行の高さは 小 → 大 → 中）
    await page.locator("thead th").nth(1).getByRole("separator").dblclick();
    await expect.poll(async () => Math.round((await page.locator("thead th").nth(1).boundingBox())!.width)).toBe(Math.round(before));
    await page.getByRole("button", { name: /行の高さ/ }).click();
    await page.getByRole("button", { name: /行の高さ/ }).click();
    await expect(page.getByRole("button", { name: /行の高さ 中/ })).toBeVisible();
  });

  test("ドラッグで範囲を選んでもマスは開かず、ふつうに押すと開く", async ({ page }) => {
    const a = page.getByRole("button", { name: `${staff.name} ${Number(date.slice(8))}日`, exact: true });
    const b = page.getByRole("button", { name: `${staff.name} ${Number(date.slice(8)) + 1}日`, exact: true });
    await a.hover();
    await page.mouse.down();
    await b.hover();
    await page.mouse.up();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByRole("button", { name: "コピー" })).toBeVisible();
    await b.click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});
