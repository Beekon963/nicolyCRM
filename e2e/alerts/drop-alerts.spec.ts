import { expect, test } from "@playwright/test";
import { SEED_USERS } from "../../scripts/seed/constants.mts";
import { cleanupEvent, dropStaff, makeEvent, makeStaff, one, sql } from "../helpers/db";

/**
 * Phase 6: 確定していた人がキャンセルになったら、ほかのメンバー（ここでは管理者）の画面に赤いポップアップが出る。
 * 「代わりの人を探す」で候補の画面へ進み、閉じたあとは出ない。
 */
test("キャンセルが出ると赤いポップアップが出て、候補を探す画面へ進める。閉じたら次は出ない（スマホ幅）", async ({ page }) => {
  const ev = await makeEvent("public.jst_today() + 2", { required: 1 });
  // キャンセルになる人はこのテストで作る
  const staff = await makeStaff("取消 一郎");
  try {
    const a = await one<{ id: string }>(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed') returning id`, [
      ev.id,
      staff.id,
      ev.roleId,
    ]);
    // 前に見たお知らせは出さない（このテストの分だけ出す）
    await sql(`insert into alert_seen (user_id, seen_at) values ($1, now()) on conflict (user_id) do update set seen_at = now()`, [SEED_USERS.manager.id]);
    await sql(`update assignments set status = 'cancelled', cancel_reason_code = 'self' where id = $1`, [a.id]);

    await page.goto("/");
    const popup = page.getByRole("dialog", { name: /欠員が出ました/ });
    await expect(popup).toBeVisible();
    const item = popup.getByTestId("drop-alerts").locator("li", { hasText: ev.venue });
    await expect(item).toContainText(`${staff.name}さんが キャンセル`);
    await expect(item).toContainText("欠1");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

    await item.getByRole("link", { name: "代わりの人を探す" }).click();
    await expect(page).toHaveURL(new RegExp(`/events/${ev.id}/candidates`));
    await expect(popup).toBeHidden();

    // 開き直して、お知らせを聞き終わってもポップアップは出ない
    const asked = page.waitForResponse((r) => r.request().method() === "POST" && !!r.request().headers()["next-action"]);
    await page.reload();
    await asked;
    await page.waitForTimeout(300);
    await expect(page.getByRole("dialog", { name: /欠員が出ました/ })).toBeHidden();
  } finally {
    await cleanupEvent(ev.id);
    await dropStaff(staff.id);
  }
});
