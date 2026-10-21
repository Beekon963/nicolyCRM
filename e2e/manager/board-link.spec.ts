import { expect, test } from "@playwright/test";
import { cleanupEvent, dropStaff, freeFutureDate, makeEvent, makeStaff, one, sql } from "../helpers/db";

/**
 * Phase 17: 稼働表を見ただけで分かるようにする。
 * - マスはしっかり塗る（確定 = 会場の色、足りない = 赤、○ は丸い地）
 * - マスに乗せる・押すと、同じ現場のマスが光り、ほかは薄くなる。足りない現場なら、その日○の人も光る
 * - 会場のボタンで同じ会場だけ光る。「次の欠員へ」で足りない現場へ飛ぶ。Esc で戻る
 */
test.describe("稼働表のつながり", () => {
  let date = "";
  let eventId = "";
  let venue = "";
  let roleId = "";
  let member: { id: string; name: string };
  let free: { id: string; name: string };
  let otherStaff: { id: string; name: string };
  let clientId = "";
  /** 同じ月の別の会場の現場（そろっている）。「ほかのマスは薄くなる」を見るためのもの */
  let otherEventId = "";

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("nicoly.board.view", '"table"'));
    date = await freeFutureDate();
    const ev = await makeEvent(`'${date}'::date`, { required: 2 });
    eventId = ev.id;
    venue = ev.venue;
    roleId = ev.roleId;
    clientId = (await one<{ id: string }>(`insert into companies (kind, name, status) values ('client', $1, 'active') returning id`, [`E2Eつながり${Math.random().toString(36).slice(2, 8)}`])).id;
    await sql(`update events set client_id = $1 where id = $2`, [clientId, eventId]);
    // 1人は確定、もう1人はその日○（打診の候補）
    member = await makeStaff("つながり 一郎");
    free = await makeStaff("つながり 二郎");
    await sql(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed')`, [eventId, member.id, roleId]);
    await sql(`insert into availability (staff_id, date, status, source) values ($1, $2::date, 'ok', 'admin')`, [free.id, date]);
    // 先の月にはダミーデータの現場がないので、別の会場のそろった現場を1つ作る
    const other = await makeEvent(`'${date}'::date`, { required: 1, clientId });
    otherEventId = other.id;
    await sql(`update events set venue_id = (select id from venues where is_active and name <> $2 order by name limit 1) where id = $1`, [otherEventId, venue]);
    otherStaff = await makeStaff("つながり 三郎");
    await sql(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed')`, [otherEventId, otherStaff.id, other.roleId]);
  });

  test.afterEach(async () => {
    await cleanupEvent(eventId);
    await cleanupEvent(otherEventId);
    await sql(`delete from companies where id = $1`, [clientId]);
    await dropStaff(member.id, free.id, otherStaff.id);
  });

  test("マスはしっかり塗る。欠員の現場に乗せると、同じ現場の人と、その日○の人が光り、ほかは薄くなる", async ({ page, isMobile }) => {
    test.skip(isMobile, "マウスを乗せる操作は PC で確かめる");
    await page.goto(`/events/board?month=${date.slice(0, 7)}`);
    const day = Number(date.slice(8));
    const client = await one<{ name: string }>(`select name from companies where id = $1`, [clientId]);
    const eventTile = page.getByRole("button", { name: `${client.name} ${day}日`, exact: true }).locator('[data-tile="shortage"]');
    const memberTile = page.getByRole("button", { name: `${member.name} ${day}日`, exact: true }).locator('[data-tile="confirmed"]');
    const freeMark = page.getByRole("button", { name: `${free.name} ${day}日`, exact: true }).locator('[data-avail="ok"]');
    // 足りない現場は赤、確定は会場の色（白ではない）、○ は緑の丸い地
    await expect(eventTile).toHaveCSS("background-color", "rgb(217, 45, 32)");
    await expect(memberTile).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(freeMark).toHaveCSS("background-color", "rgb(209, 250, 229)");

    // ほかの現場のマス（別の会場のそろった現場に入る人）は薄くなる
    const other = page.getByRole("button", { name: `${otherStaff.name} ${day}日`, exact: true }).locator('[data-tile="confirmed"]');
    await eventTile.hover();
    await expect(memberTile).toHaveCSS("opacity", "1");
    await expect(freeMark).toHaveCSS("opacity", "1");
    await expect(other).toHaveCSS("opacity", "0.28");
    // 光る枠（青）と、○の人の緑の枠
    await expect(memberTile).toHaveCSS("box-shadow", /rgb\(0, 74, 174\)/);
    await expect(freeMark).toHaveCSS("box-shadow", /rgb\(4, 120, 87\)/);
    // その行の名前の見出しが太字に
    await expect(page.locator(`tr[data-kind="staff"]:has([data-event="${eventId}"]) > th`)).toHaveCSS("font-weight", "700");

    // 離すと戻る
    await page.mouse.move(0, 0);
    await expect(other).toHaveCSS("opacity", "1");

    // 押すと光ったまま。Esc で戻る
    await eventTile.click();
    await page.keyboard.press("Escape"); // 開いた画面を閉じる
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.mouse.move(0, 0);
    await expect(other).toHaveCSS("opacity", "0.28");
    await expect(page.getByRole("button", { name: "光らせるのをやめる" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(other).toHaveCSS("opacity", "1");
  });

  test("会場のボタンで同じ会場だけ光る。「次の欠員へ」で足りない現場へ飛ぶ", async ({ page }) => {
    await page.goto(`/events/board?month=${date.slice(0, 7)}`);
    // 会場のボタンは、表の上の「会場」を押したときだけ出る（表が下がらないように）
    const chips = page.getByRole("group", { name: "会場（押すと同じ会場のマスが光る）" });
    await expect(chips).toBeHidden();
    await page.getByRole("button", { name: "会場で光らせる" }).click();
    const chip = chips.getByRole("button", { name: new RegExp(`^${venue}`) });
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    const day = Number(date.slice(8));
    const mine = page.getByRole("button", { name: `${member.name} ${day}日`, exact: true }).locator('[data-tile="confirmed"]');
    const other = page.getByRole("button", { name: `${otherStaff.name} ${day}日`, exact: true }).locator('[data-tile="confirmed"]');
    await expect(mine).toHaveCSS("opacity", "1");
    await expect(other).toHaveCSS("opacity", "0.28");
    await page.getByRole("button", { name: "光らせるのをやめる" }).click();
    await expect(other).toHaveCSS("opacity", "1");

    // 次の欠員へ（欠員の現場のマスが見えて、つながりが光る）
    const jump = page.getByRole("button", { name: /次の欠員へ/ });
    await expect(jump).toBeVisible();
    await jump.click();
    await expect(page.locator('[data-board][data-linking]')).toHaveCount(1);
    await expect(page.locator('[data-tile="shortage"].animate-board-flash')).toHaveCount(1);
  });
});
