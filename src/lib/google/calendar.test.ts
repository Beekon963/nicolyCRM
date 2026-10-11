import { describe, expect, it, vi } from "vitest";
import { CalendarClient, googleCalendarAddUrl, overlaps } from "./calendar";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Google カレンダー（研修の予約）", () => {
  it("予定のある時間を読む。この CRM が入れた予約と「予定なし」の予定は除き、終日の予定は日本時間の1日", async () => {
    const fetchMock = vi.fn(async (...args: [string | URL | Request]) =>
      (void args,
      json(200, {
        items: [
          { start: { dateTime: "2026-10-20T10:00:00+09:00" }, end: { dateTime: "2026-10-20T11:00:00+09:00" } },
          { start: { dateTime: "2026-10-20T13:00:00+09:00" }, end: { dateTime: "2026-10-20T14:00:00+09:00" }, extendedProperties: { private: { nicolyBooking: "b1" } } },
          { start: { dateTime: "2026-10-20T15:00:00+09:00" }, end: { dateTime: "2026-10-20T16:00:00+09:00" }, transparency: "transparent" },
          { start: { date: "2026-10-21" }, end: { date: "2026-10-22" } },
        ],
      })),
    );
    const c = new CalendarClient("tok", "owner@example.com", "sa@example.iam.gserviceaccount.com", fetchMock as unknown as typeof fetch);
    const busy = await c.busy(new Date("2026-10-20T00:00:00Z"), new Date("2026-10-22T00:00:00Z"));
    expect(busy.map((b) => [b.start.toISOString(), b.end.toISOString()])).toEqual([
      ["2026-10-20T01:00:00.000Z", "2026-10-20T02:00:00.000Z"],
      ["2026-10-20T15:00:00.000Z", "2026-10-21T15:00:00.000Z"],
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/calendars/${encodeURIComponent("owner@example.com")}/events?`);
  });

  it("予定と重なる枠を見分ける（端が接しているだけなら重ならない）", () => {
    const busy = [{ start: new Date("2026-10-20T01:00:00Z"), end: new Date("2026-10-20T02:00:00Z") }];
    expect(overlaps({ start: new Date("2026-10-20T01:30:00Z"), end: new Date("2026-10-20T02:30:00Z") }, busy)).toBe(true);
    expect(overlaps({ start: new Date("2026-10-20T02:00:00Z"), end: new Date("2026-10-20T03:00:00Z") }, busy)).toBe(false);
  });

  it("共有されていないときは、直し方を日本語で伝える", async () => {
    const c = new CalendarClient("tok", "owner@example.com", "sa@example.iam.gserviceaccount.com", (async () => json(404, {})) as unknown as typeof fetch);
    await expect(c.insert({ summary: "x", description: "", start: new Date(), end: new Date(), bookingId: "b" })).rejects.toThrow("「予定の変更」で追加");
  });

  it("「Google カレンダーに追加」のリンク", () => {
    const url = googleCalendarAddUrl({ title: "オンライン研修", start: new Date("2026-10-20T01:00:00Z"), end: new Date("2026-10-20T02:00:00Z"), details: "URL" });
    expect(url).toContain("action=TEMPLATE");
    expect(url).toContain("dates=20261020T010000Z%2F20261020T020000Z");
  });
});
