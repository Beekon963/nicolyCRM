import { describe, expect, it } from "vitest";
import { buildBoard, type BoardEvent, type BoardInput } from "./index";
import { clientFill, filterBoard, filterCounts, freeCountByDate, isFree, NO_FILTERS, seatsOf, sortChips } from "./view";

const ev = (p: Partial<BoardEvent> & Pick<BoardEvent, "id" | "date">): BoardEvent => ({
  client_id: "c1",
  client_name: "テスト通信",
  venue_id: "v1",
  venue_name: "DSテスト中央",
  venue_color: "sky",
  required_total: 2,
  confirmed_total: 0,
  shortage_total: 2,
  offered_count: 0,
  cancelled: false,
  ...p,
});

const input: BoardInput = {
  month: "2026-11",
  today: "2026-11-03",
  holidays: {},
  events: [
    ev({ id: "past", date: "2026-11-01", confirmed_total: 1, shortage_total: 1 }),
    ev({ id: "full", date: "2026-11-05", confirmed_total: 2, shortage_total: 0 }),
    ev({ id: "short", date: "2026-11-05", venue_name: "DSテスト北", confirmed_total: 1, shortage_total: 1, offered_count: 1 }),
    ev({ id: "other", date: "2026-11-06", client_id: "c2", client_name: "アオゾラ", confirmed_total: 2, shortage_total: 0 }),
    ev({ id: "stop", date: "2026-11-07", cancelled: true }),
  ],
  staff: [
    { id: "s1", name: "青木", kana: "あおき", rank_name: null, rank_order: null, nearest_station: "" },
    { id: "s2", name: "井上", kana: "いのうえ", rank_name: null, rank_order: null, nearest_station: "" },
    { id: "s3", name: "上田", kana: "うえだ", rank_name: null, rank_order: null, nearest_station: "" },
  ],
  assignments: [
    { id: "a1", event_id: "full", staff_id: "s1", role_id: "r", status: "confirmed" },
    { id: "a2", event_id: "short", staff_id: "s2", role_id: "r", status: "offered" },
  ],
  availability: [
    // 青木: 5日は○だが確定ずみ。6日は○で空き
    { staff_id: "s1", date: "2026-11-05", status: "ok" },
    { staff_id: "s1", date: "2026-11-06", status: "ok" },
    // 井上: 5日は○だが打診中
    { staff_id: "s2", date: "2026-11-05", status: "ok" },
    // 上田: 過ぎた日（1日）だけ○、5日は△
    { staff_id: "s3", date: "2026-11-01", status: "ok" },
    { staff_id: "s3", date: "2026-11-05", status: "maybe" },
  ],
};
const board = buildBoard(input);

describe("○で空いている人", () => {
  it("○で、その日に確定・打診中・補欠がない人だけ（△・×・予定のある人は入らない）", () => {
    const s1 = board.staff.find((s) => s.id === "s1")!;
    expect(isFree(s1.cells["2026-11-05"])).toBe(false);
    expect(isFree(s1.cells["2026-11-06"])).toBe(true);
    const counts = freeCountByDate(board);
    expect(counts["2026-11-05"]).toBe(0);
    expect(counts["2026-11-06"]).toBe(1);
    expect(counts["2026-11-01"]).toBe(1);
  });

  it("キャンセル・当日不稼働になった現場は予定に数えない", () => {
    const b = buildBoard({ ...input, assignments: [{ id: "a1", event_id: "full", staff_id: "s1", role_id: "r", status: "cancelled" }] });
    expect(isFree(b.staff.find((s) => s.id === "s1")!.cells["2026-11-05"])).toBe(true);
  });
});

describe("絞り込み", () => {
  it("何も選ばなければそのまま", () => {
    expect(filterBoard(board, NO_FILTERS)).toBe(board);
  });

  it("欠員の現場だけ: そろった・中止の現場と、欠員のない取引先の行を隠す", () => {
    const b = filterBoard(board, { ...NO_FILTERS, shortageOnly: true });
    expect(b.clients.map((c) => c.id)).toEqual(["c1"]);
    const cells = b.clients[0].cells;
    expect(cells["2026-11-05"].map((e) => e.id)).toEqual(["short"]);
    expect(cells["2026-11-01"].map((e) => e.id)).toEqual(["past"]);
    expect(cells["2026-11-07"]).toEqual([]);
    // スタッフと日付はそのまま
    expect(b.staff).toHaveLength(3);
    expect(b.days).toHaveLength(30);
  });

  it("○で空いている人だけ: 見えている日に1日でも○で空いている人", () => {
    expect(filterBoard(board, { ...NO_FILTERS, freeOnly: true }).staff.map((s) => s.id)).toEqual(["s1", "s3"]);
    // 今日から先だけなら、過ぎた日だけ○の上田は出ない
    expect(filterBoard(board, { ...NO_FILTERS, freeOnly: true, fromToday: true }).staff.map((s) => s.id)).toEqual(["s1"]);
  });

  it("今日から先だけ: 今日の列から始める。過ぎた日の欠員は数えない", () => {
    const b = filterBoard(board, { ...NO_FILTERS, fromToday: true });
    expect(b.days[0].date).toBe("2026-11-03");
    expect(b.days).toHaveLength(28);
    expect(filterBoard(board, { shortageOnly: true, freeOnly: false, fromToday: true }).clients[0].cells["2026-11-01"]).toBeUndefined();
  });

  it("ボタンに出す件数（欠員の現場・○で空いている人・過ぎた日）", () => {
    expect(filterCounts(board, { fromToday: false })).toEqual({ shortage: 2, free: 2, past: 2 });
    expect(filterCounts(board, { fromToday: true })).toEqual({ shortage: 1, free: 1, past: 2 });
  });

  it("今日が月の外（先の月）なら、過ぎた日はない", () => {
    const next = buildBoard({ ...input, month: "2026-12", events: [] });
    expect(filterCounts(next, { fromToday: true }).past).toBe(0);
    expect(filterBoard(next, { ...NO_FILTERS, fromToday: true }).days).toHaveLength(31);
  });
});

describe("人数分のマス", () => {
  it("確定 → 打診中（縞）→ 空き の順。0/2 は空、1/2 は半分、2/2 は全部", () => {
    expect(seatsOf({ required: 2, confirmed: 0, offered: 0 })).toEqual(["empty", "empty"]);
    expect(seatsOf({ required: 2, confirmed: 1, offered: 0 })).toEqual(["filled", "empty"]);
    expect(seatsOf({ required: 2, confirmed: 1, offered: 1 })).toEqual(["filled", "offered"]);
    expect(seatsOf({ required: 2, confirmed: 2, offered: 0 })).toEqual(["filled", "filled"]);
  });

  it("必要人数より多い確定・打診中は数えない", () => {
    expect(seatsOf({ required: 2, confirmed: 3, offered: 2 })).toEqual(["filled", "filled"]);
    expect(seatsOf({ required: 3, confirmed: 1, offered: 5 })).toEqual(["filled", "offered", "offered"]);
    expect(seatsOf({ required: 0, confirmed: 0, offered: 0 })).toEqual([]);
  });

  it("マスの中は欠員の現場を先に、中止はあとに", () => {
    const chips = [...board.clients.find((c) => c.id === "c1")!.cells["2026-11-05"]].reverse();
    expect(sortChips(chips).map((e) => e.id)).toEqual(["short", "full"]);
  });

  it("取引先の行の埋まり具合（中止を除く）", () => {
    const c1 = board.clients.find((c) => c.id === "c1")!;
    expect(clientFill(c1.cells, board.days)).toEqual({ required: 6, shortage: 2, filled: 4, pct: 66 });
  });
});
