import { describe, expect, it } from "vitest";
import { buildBoard, type BoardEvent, type BoardInput, type BoardStaff } from "./index";

const ev = (p: Partial<BoardEvent> & Pick<BoardEvent, "id" | "date">): BoardEvent => ({
  client_id: "c1",
  client_name: "テスト通信",
  venue_id: "v1",
  venue_name: "DSテスト中央",
  required_total: 2,
  confirmed_total: 0,
  shortage_total: 2,
  offered_count: 0,
  cancelled: false,
  ...p,
});

const st = (p: Partial<BoardStaff> & Pick<BoardStaff, "id" | "name">): BoardStaff => ({
  kana: "",
  rank_name: null,
  rank_order: null,
  nearest_station: "",
  ...p,
});

const base: BoardInput = {
  month: "2026-11",
  today: "2026-11-03",
  holidays: { "2026-11-03": "文化の日" },
  events: [],
  staff: [],
  assignments: [],
  availability: [],
};

describe("稼働表を組み立てる", () => {
  it("月の日付を1日から末日まで並べ、曜日・祝日・今日を付ける", () => {
    const b = buildBoard(base);
    expect(b.days).toHaveLength(30);
    expect(b.days[0]).toMatchObject({ date: "2026-11-01", day: 1, weekday: "日", holiday: null, isToday: false });
    expect(b.days[2]).toMatchObject({ date: "2026-11-03", weekday: "火", holiday: "文化の日", isToday: true });
    expect(b.days.at(-1)?.date).toBe("2026-11-30");
  });

  it("上の段: 取引先ごとに、日付のマスへ現場を入れる。中止は欠員に数えない", () => {
    const b = buildBoard({
      ...base,
      events: [
        ev({ id: "e1", date: "2026-11-07", confirmed_total: 1, shortage_total: 1 }),
        ev({ id: "e2", date: "2026-11-07", venue_name: "DSテスト北", confirmed_total: 2, shortage_total: 0 }),
        ev({ id: "e3", date: "2026-11-08", client_id: "c2", client_name: "アオゾラ", cancelled: true }),
        ev({ id: "x", date: "2026-12-01" }),
      ],
    });
    expect(b.clients.map((c) => c.name)).toEqual(["アオゾラ", "テスト通信"]);
    const c1 = b.clients.find((c) => c.id === "c1")!;
    expect(c1.cells["2026-11-07"].map((e) => e.venueName)).toEqual(["DSテスト中央", "DSテスト北"]);
    expect(b.clients[0].cells["2026-11-08"][0]).toMatchObject({ cancelled: true, shortage: 0 });
    expect(b.days[6]).toMatchObject({ required: 4, confirmed: 3, shortage: 1 });
    expect(b.days[7]).toMatchObject({ required: 0, shortage: 0 });
    expect(b.totals).toMatchObject({ events: 2, required: 4, confirmed: 3, shortage: 1 });
  });

  it("下の段: ランク順 → かな順。ランクなしは最後", () => {
    const b = buildBoard({
      ...base,
      staff: [
        st({ id: "s1", name: "鈴木", kana: "すずき", rank_name: "A", rank_order: 4 }),
        st({ id: "s2", name: "青木", kana: "あおき", rank_name: "A", rank_order: 4 }),
        st({ id: "s3", name: "田中", kana: "たなか" }),
        st({ id: "s4", name: "山本", kana: "やまもと", rank_name: "SS", rank_order: 1 }),
      ],
    });
    expect(b.staff.map((s) => s.name)).toEqual(["山本", "青木", "鈴木", "田中"]);
  });

  it("下の段: 確定・打診中の現場と ○△× を入れ、確定した日だけ稼働日数に数える（中止の現場は除く）", () => {
    const b = buildBoard({
      ...base,
      events: [
        ev({ id: "e1", date: "2026-11-07" }),
        ev({ id: "e2", date: "2026-11-08", venue_name: "DSテスト北" }),
        ev({ id: "e3", date: "2026-11-09", cancelled: true }),
      ],
      staff: [st({ id: "s1", name: "山本" })],
      assignments: [
        { id: "a1", event_id: "e1", staff_id: "s1", role_id: "r1", status: "confirmed" },
        { id: "a2", event_id: "e2", staff_id: "s1", role_id: "r1", status: "offered" },
        { id: "a3", event_id: "e3", staff_id: "s1", role_id: "r1", status: "confirmed" },
      ],
      availability: [
        { staff_id: "s1", date: "2026-11-07", status: "ok" },
        { staff_id: "s1", date: "2026-11-10", status: "ng" },
        { staff_id: "s1", date: "2026-10-31", status: "ok" },
      ],
    });
    const row = b.staff[0];
    expect(row.cells["2026-11-07"]).toEqual({
      availability: "ok",
      assignments: [{ id: "a1", eventId: "e1", roleId: "r1", venueName: "DSテスト中央", clientName: "テスト通信", status: "confirmed" }],
    });
    expect(row.cells["2026-11-08"].assignments[0]).toMatchObject({ status: "offered", venueName: "DSテスト北" });
    expect(row.cells["2026-11-09"].assignments).toEqual([]);
    expect(row.cells["2026-11-10"]).toEqual({ availability: "ng", assignments: [] });
    expect(row.cells["2026-10-31"]).toBeUndefined();
    expect(row.workedDays).toBe(1);
    expect(b.totals.workedDays).toBe(1);
  });

  it("同じ日に2つ入っているときは確定 → 打診中 → 補欠の順", () => {
    const b = buildBoard({
      ...base,
      events: [ev({ id: "e1", date: "2026-11-07" }), ev({ id: "e2", date: "2026-11-07", venue_name: "DSテスト北" })],
      staff: [st({ id: "s1", name: "山本" })],
      assignments: [
        { id: "a1", event_id: "e1", staff_id: "s1", role_id: "r1", status: "waitlisted" },
        { id: "a2", event_id: "e2", staff_id: "s1", role_id: "r1", status: "confirmed" },
      ],
    });
    expect(b.staff[0].cells["2026-11-07"].assignments.map((a) => a.status)).toEqual(["confirmed", "waitlisted"]);
  });
});
