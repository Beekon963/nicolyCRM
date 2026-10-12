import { expect, test } from "@playwright/test";
import { cleanupEvent, makeEvent, one } from "../helpers/db";
import { expectNoHorizontalScroll } from "../helpers/layout";

/**
 * Phase 12: 遠方の上乗せ。現場の人の「…」から最寄り駅からの時間を選ぶ（管理者も選べる。金額は出ない）
 */
test("最寄り駅からの時間を選ぶと「遠方 ＋1回分」が付き、なしに戻せる", async ({ page }) => {
  const ev = await makeEvent("public.jst_today() + 20", { required: 1 });
  try {
    const staff = await one<{ id: string; name: string }>(
      `select id, name from staff s where status = 'active'
          and not exists (select 1 from assignments a join events e on e.id = a.event_id where a.staff_id = s.id and e.date = public.jst_today() + 20)
        order by random() limit 1`,
    );
    const a = await one<{ id: string }>(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed') returning id`, [ev.id, staff.id, ev.roleId]);
    await page.goto(`/events/${ev.id}`);
    await page.getByRole("button", { name: `${staff.name}の状態を変える` }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("最寄り駅から現場までの時間（遠方の上乗せ）").selectOption({ label: "2時間まで（遠方 ＋1回分）" });
    await expect(page.getByText("遠方の上乗せを 1回分にしました")).toBeVisible();
    await expectNoHorizontalScroll(page);
    // 管理者には金額を出さない
    await expect(dialog).not.toContainText("円");
    await page.keyboard.press("Escape");
    await expect(page.getByText("遠方 ＋1回分")).toBeVisible();
    expect((await one<{ travel_steps: number }>(`select travel_steps from assignments where id = $1`, [a.id])).travel_steps).toBe(1);

    await page.getByRole("button", { name: `${staff.name}の状態を変える` }).click();
    await page.getByRole("dialog").getByLabel("最寄り駅から現場までの時間（遠方の上乗せ）").selectOption({ label: "1時間30分まで（なし）" });
    await expect(page.getByText("遠方の上乗せをなしにしました")).toBeVisible();
    expect((await one<{ travel_steps: number }>(`select travel_steps from assignments where id = $1`, [a.id])).travel_steps).toBe(0);
  } finally {
    await cleanupEvent(ev.id);
  }
});
