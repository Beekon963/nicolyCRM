import { expect, test } from "@playwright/test";
import { freeFutureDate, one, sql } from "../helpers/db";
import { expectNoHorizontalScroll } from "../helpers/layout";

test("来週の土日2日分の現場（クローザー2名・キャッチャー1名）を1分以内にまとめて作れる", async ({ page }) => {
  const started = Date.now();
  await page.goto("/events/bulk");
  await expectNoHorizontalScroll(page);
  await page.getByLabel("取引先", { exact: true }).selectOption({ index: 1 });
  await page.getByLabel("会場", { exact: true }).selectOption({ index: 2 });
  await page.getByRole("button", { name: "来週の土日" }).click();
  await page.getByRole("button", { name: "クローザーの必要人数を1増やす" }).click();
  await page.getByRole("button", { name: "キャッチャーの必要人数を1増やす" }).click();
  await expect(page.getByRole("textbox", { name: "クローザーの必要人数" })).toHaveValue("2");
  await page.getByRole("button", { name: "2件の現場を作る" }).click();
  await expect(page.getByRole("heading", { name: /^グループ:/ })).toBeVisible();
  const rows = page.getByRole("main").locator("li a:visible");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("0/3人 欠員3");
  expect(Date.now() - started).toBeLessThan(60_000);
});

test.describe("候補を探す → 打診", () => {
  let eventId = "";
  let names: { ok: string; ng: string; venueNg: string; double: string };

  test.beforeEach(async () => {
    // 準備: 未来の日に現場を作り、○・×・会場NG・同日別現場 の人を用意する
    const date = await freeFutureDate();
    const venue = await one<{ id: string }>(`select id from venues where is_active and address <> '' order by random() limit 1`);
    const client = await one<{ id: string }>(`select id from companies where kind = 'client' limit 1`);
    const closer = await one<{ id: string }>(`select id from roles where name = 'クローザー'`);
    const staff = await sql<{ id: string; name: string }>(
      `select s.id, s.name from staff s join staff_roles sr on sr.staff_id = s.id
        where s.status = 'active' and sr.role_id = $1
          and not exists (select 1 from staff_ng n where n.staff_id = s.id)
        order by random() limit 4`,
      [closer.id],
    );
    const [ok, ng, venueNg, double] = staff;
    names = { ok: ok.name, ng: ng.name, venueNg: venueNg.name, double: double.name };
    const ev = await one<{ id: string }>(
      `insert into events (client_id, venue_id, date, start_time, end_time) values ($1, $2, $3, '10:00', '19:00') returning id`,
      [client.id, venue.id, date],
    );
    eventId = ev.id;
    await sql(`insert into event_requirements (event_id, role_id, required_count) values ($1, $2, 2)`, [eventId, closer.id]);
    await sql(
      `insert into availability (staff_id, date, status) values ($1, $3, 'ok'), ($2, $3, 'ng')
       on conflict (staff_id, date) do update set status = excluded.status`,
      [ok.id, ng.id, date],
    );
    await sql(`insert into staff_ng (staff_id, venue_id, reason) values ($1, $2, 'テスト')`, [venueNg.id, venue.id]);
    const other = await one<{ id: string }>(
      `insert into events (client_id, venue_id, date) values ($1, (select id from venues where id <> $2 limit 1), $3) returning id`,
      [client.id, venue.id, date],
    );
    await sql(`insert into assignments (event_id, staff_id, role_id, status) values ($1, $2, $3, 'confirmed')`, [other.id, double.id, closer.id]);
  });

  test("×・会場NG・同日に別現場の人は警告付きで下に並ぶ", async ({ page }) => {
    await page.goto(`/events/${eventId}/candidates`);
    await expectNoHorizontalScroll(page);
    const items = page.getByRole("main").getByRole("listitem");
    const order = await items.allTextContents();
    const idx = (n: string) => order.findIndex((t) => t.includes(n));
    for (const warned of [names.ng, names.venueNg, names.double]) expect(idx(names.ok)).toBeLessThan(idx(warned));
    await expect(items.filter({ hasText: names.venueNg })).toContainText("会場NG");
    await expect(items.filter({ hasText: names.double })).toContainText("同日に別現場");
    await expect(items.filter({ hasText: names.ng })).toContainText("×");
  });

  test("3人を選んで一括打診すると、LINEで送る（スマホ）・コピー用の文面が出る", async ({ page, isMobile }) => {
    await page.goto(`/events/${eventId}/candidates`);
    await page.getByRole("checkbox", { name: `${names.ok}を選ぶ` }).click();
    await page.getByRole("checkbox", { name: `${names.ng}を選ぶ` }).click();
    await page.getByRole("checkbox", { name: `${names.venueNg}を選ぶ` }).click();
    await expect(page.getByText("3人を選択中")).toBeVisible();
    await page.getByRole("button", { name: "打診する" }).click();
    // NG・× の人が入っているので確認が出る
    await expect(page.getByText("注意が必要な人が含まれています")).toBeVisible();
    await page.getByRole("button", { name: "このまま打診する" }).click();

    const dialog = page.getByRole("dialog", { name: "打診の文面を送る" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("listitem")).toHaveCount(3);
    const first = dialog.getByRole("listitem").filter({ hasText: names.ok });
    await expect(first.locator("pre")).toContainText("/m/");
    if (isMobile) {
      const href = await first.getByRole("link", { name: "LINEで送る" }).getAttribute("href");
      expect(href).toMatch(/^https:\/\/line\.me\/R\/share\?text=/);
      const text = decodeURIComponent(href!.split("text=")[1]);
      expect(text).toContain(names.ok.split(" ")[0]);
      expect(text).toMatch(/\/m\/[A-Za-z0-9_-]{43}/);
    } else {
      // PC 版 LINE ではこの方式が動かないので、PC ではコピーだけ
      await expect(first.getByRole("link", { name: "LINEで送る" })).toHaveCount(0);
      await expect(first.getByRole("button", { name: "コピー" })).toBeVisible();
    }
    const offered = await sql(`select * from assignments where event_id = $1 and status = 'offered'`, [eventId]);
    expect(offered).toHaveLength(3);
  });

  test("欠員は赤で出て、確定にすると消える", async ({ page }) => {
    const closer = await one<{ id: string }>(`select id from roles where name = 'クローザー'`);
    const staff = await sql<{ id: string; name: string }>(`select id, name from staff where status = 'active' and id not in (select staff_id from assignments where event_id = $1) limit 2`, [eventId]);
    for (const s of staff) await sql(`insert into assignments (event_id, staff_id, role_id) values ($1, $2, $3)`, [eventId, s.id, closer.id]);
    await page.goto(`/events/${eventId}`);
    const need = page.locator("section", { has: page.getByRole("heading", { name: "必要人数" }) }).last();
    await expect(need).toContainText("0/2人 欠員2");
    for (const s of staff) {
      await page.getByRole("button", { name: `${s.name}の状態を変える` }).click();
      await page.getByRole("button", { name: "確定にする" }).click();
      await expect(page.getByText(`${s.name}さんを「確定」にしました`)).toBeVisible();
    }
    await expect(need).toContainText("2/2人");
    await expect(need).not.toContainText("欠員");
  });
});
