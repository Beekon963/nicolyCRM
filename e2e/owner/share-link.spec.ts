import { expect, test } from "@playwright/test";
import { SENTINELS } from "../../scripts/seed/constants.mts";
import { sql } from "../helpers/db";
import { expectNoHorizontalScroll } from "../helpers/layout";

/**
 * 稼働表の「見るだけリンク」（Phase 1.5）: オーナーが作り、ログインなしで見られる。止める・作り直すと古いリンクは使えない。
 */
// リンクは1つだけなので、PC のプロジェクトだけで順番に確かめる（スマホ幅の表示はこの中で確かめる）
test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => isMobile, "見るだけリンクは1つだけなので、PC のプロジェクトでまとめて確かめる");

test.afterAll(async () => {
  await sql(`delete from share_links where kind = 'board'`);
});

test("オーナーが作ったリンクを、ログインなしで開ける。金額・電話番号は出ない", async ({ page, browser }) => {
  await sql(`delete from share_links where kind = 'board'`);
  await page.goto("/events/board");
  await page.getByRole("button", { name: "見るだけリンク" }).click();
  const dialog = page.getByRole("dialog", { name: "見るだけリンク" });
  await dialog.getByRole("button", { name: "リンクを作る" }).click();
  await expect(dialog.getByText("公開中")).toBeVisible();
  const url = (await dialog.getByTestId("share-url").textContent())!.trim();
  expect(url).toMatch(/\/s\/[\w-]{40,}$/);

  // ログインしていない人として開く
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });
  const guest = await ctx.newPage();
  const res = await guest.goto(new URL(url).pathname);
  expect(res?.headers()["x-robots-tag"]).toContain("noindex");
  expect(res?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(guest.getByRole("heading", { name: "NICOLY 稼働表（見るだけ）" })).toBeVisible();
  await expect(guest.getByRole("region", { name: /稼働表/ })).toBeVisible();
  await expectNoHorizontalScroll(guest);
  // マスは押せない（見るだけ）
  await expect(guest.getByRole("region", { name: /稼働表/ }).getByRole("button")).toHaveCount(0);
  const html = await guest.content();
  for (const s of Object.values(SENTINELS)) expect(html).not.toContain(String(s));
  expect(html).not.toMatch(/090-0000-|\/m\/[\w-]{40,}/);
  await ctx.close();
});

test("止めると開けず、作り直すと古いリンクは使えない", async ({ page, browser }) => {
  const guestOpen = async (path: string) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const p = await ctx.newPage();
    await p.goto(path);
    const ok = await p.getByRole("heading", { name: "NICOLY 稼働表（見るだけ）" }).isVisible();
    const ng = await p.getByRole("heading", { name: "稼働表を開けません" }).isVisible();
    await ctx.close();
    return ok ? "ok" : ng ? "ng" : "?";
  };

  await page.goto("/events/board");
  await page.getByRole("button", { name: "見るだけリンク" }).click();
  const dialog = page.getByRole("dialog", { name: "見るだけリンク" });
  const oldPath = new URL((await dialog.getByTestId("share-url").textContent())!.trim()).pathname;

  await dialog.getByRole("button", { name: /リンクを止める/ }).click();
  await expect(dialog.getByText("止めています")).toBeVisible();
  expect(await guestOpen(oldPath)).toBe("ng");

  await dialog.getByRole("button", { name: "再開する" }).click();
  await expect(dialog.getByText("公開中")).toBeVisible();
  expect(await guestOpen(oldPath)).toBe("ok");

  await dialog.getByRole("button", { name: /リンクを作り直す/ }).click();
  await dialog.getByRole("button", { name: "作り直す", exact: true }).click();
  await expect(dialog.getByTestId("share-url")).not.toHaveText(new RegExp(`${oldPath}$`));
  const newPath = new URL((await dialog.getByTestId("share-url").textContent())!.trim()).pathname;
  expect(await guestOpen(oldPath)).toBe("ng");
  expect(await guestOpen(newPath)).toBe("ok");
});

test("管理者はリンクをコピーできるが、作る・止める・作り直すはできない", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: "e2e/.auth/manager.json" });
  const page = await ctx.newPage();
  await page.goto("/events/board");
  await page.getByRole("button", { name: "見るだけリンク" }).click();
  const dialog = page.getByRole("dialog", { name: "見るだけリンク" });
  await expect(dialog.getByTestId("share-url")).toHaveText(/\/s\/[\w-]{40,}$/);
  await expect(dialog.getByRole("button", { name: /コピー/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /止める|作り直す|リンクを作る|再開/ })).toHaveCount(0);
  await ctx.close();
});
