import { describe, expect, it } from "vitest";
import { type BoardAssignment, type BoardEvent, type BoardInput, type BoardStaff, buildBoard } from "./index";
import { chipsOf, dayTotal, eventStaff, filterStaff, initialWeek, tabFromPrefs, unassignedCount, unassignedStaff, weekDates } from "./views";

const ev = (p: Partial<BoardEvent> & Pick<BoardEvent, "id" | "date">): BoardEvent => ({
  client_id: "c1",
  client_name: "架空通信",
  venue_id: "v1",
  venue_name: "イオンモール架空村山",
  venue_color: "sky",
  venue_short: "村山",
  carrier: "docomo",
  required_total: 2,
  confirmed_total: 0,
  shortage_total: 2,
  offered_count: 0,
  cancelled: false,
  ...p,
});
const st = (id: string, name: string, kana = ""): BoardStaff => ({ id, name, kana, rank_name: null, rank_order: null, nearest_station: "架空駅" });
const asg = (id: string, event_id: string, staff_id: string, status: BoardAssignment["status"]): BoardAssignment => ({ id, event_id, staff_id, role_id: "r1", status });

const input: BoardInput = {
  month: "2026-11",
  today: "2026-11-04",
  holidays: {},
  events: [ev({ id: "e1", date: "2026-11-03", confirmed_total: 1, shortage_total: 1 }), ev({ id: "e2", date: "2026-11-04", venue_id: "v2", venue_name: "架空店", venue_short: "", carrier: "au", offered_count: 1 })],
  staff: [st("s1", "検証 太郎", "けんしょう たろう"), st("s2", "試験 花子", "しけん はなこ"), st("s3", "架空 次郎"), st("s4", "模擬 三郎")],
  assignments: [asg("a1", "e1", "s1", "confirmed"), asg("a2", "e2", "s2", "offered"), asg("a3", "e2", "s1", "cancelled")],
  availability: [
    { staff_id: "s3", date: "2026-11-03", status: "ok" },
    { staff_id: "s3", date: "2026-11-04", status: "ng" },
    { staff_id: "s4", date: "2026-11-03", status: "maybe" },
    { staff_id: "s1", date: "2026-11-03", status: "ok" },
  ],
};
const board = buildBoard(input);
const row = (id: string) => board.staff.find((s) => s.id === id)!;

describe("稼働表の新しい見せ方", () => {
  it("マスは 確定・仮・取り消し・現場未定・×・空 のどれか（確定が先）", () => {
    expect(chipsOf(row("s1").cells["2026-11-03"]).map((c) => c.kind)).toEqual(["confirmed"]);
    expect(chipsOf(row("s2").cells["2026-11-04"]).map((c) => c.kind)).toEqual(["tentative"]);
    expect(chipsOf(row("s1").cells["2026-11-04"]).map((c) => c.kind)).toEqual(["dropped"]);
    expect(chipsOf(row("s3").cells["2026-11-03"])).toEqual([{ kind: "unassigned", availability: "ok" }]);
    expect(chipsOf(row("s4").cells["2026-11-03"])).toEqual([{ kind: "unassigned", availability: "maybe" }]);
    expect(chipsOf(row("s3").cells["2026-11-04"])).toEqual([{ kind: "off" }]);
    expect(chipsOf(row("s2").cells["2026-11-05"])).toEqual([{ kind: "empty" }]);
    expect(chipsOf(undefined)).toEqual([{ kind: "empty" }]);
  });

  it("現場未定の人は ○ が先、△ はあと。件数も数えられる", () => {
    expect(unassignedStaff(board, "2026-11-03").map((x) => `${x.row.name}:${x.availability}`)).toEqual(["架空 次郎:ok", "模擬 三郎:maybe"]);
    expect(unassignedStaff(board, "2026-11-04")).toEqual([]);
    expect(unassignedCount(board.staff, ["2026-11-03", "2026-11-04"])).toBe(2);
  });

  it("週は月曜はじまり。最初の週は今日の週（今日がこの月でなければ月の最初の週）", () => {
    expect(weekDates("2026-11-04")).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
    expect(weekDates("2026-11-01")[0]).toBe("2026-10-26");
    expect(initialWeek(board)[0]).toBe("2026-11-02");
    expect(initialWeek(buildBoard({ ...input, today: "2026-12-10" }))[0]).toBe("2026-10-26");
  });

  it("日ごとの配置／必要と、その現場に入っている人", () => {
    expect(dayTotal(board, "2026-11-03")).toEqual({ confirmed: 1, required: 2, shortage: 1 });
    expect(dayTotal(board, "2026-12-01")).toBeNull();
    expect(eventStaff(board, "e2", "2026-11-04").map((x) => `${x.row.name}:${x.a.status}`)).toEqual(["試験 花子:offered", "検証 太郎:cancelled"]);
  });

  it("絞り込み: 現場未定だけ・現場別・名前（ひらがな・カタカナ・空白の違いは無視）", () => {
    const dates = ["2026-11-03", "2026-11-04"];
    expect(filterStaff(board.staff, { unassignedOnly: true, venueId: null, query: "" }, dates).map((r) => r.id)).toEqual(["s3", "s4"]);
    expect(filterStaff(board.staff, { unassignedOnly: false, venueId: "v2", query: "" }, dates).map((r) => r.id)).toEqual(["s2"]);
    expect(filterStaff(board.staff, { unassignedOnly: false, venueId: null, query: "ケンショウ" }, dates).map((r) => r.id)).toEqual(["s1"]);
    expect(filterStaff(board.staff, { unassignedOnly: false, venueId: null, query: "花子" }, dates).map((r) => r.id)).toEqual(["s2"]);
    expect(filterStaff(board.staff, { unassignedOnly: true, venueId: null, query: "" }, ["2026-11-04"])).toEqual([]);
  });

  it("端末に覚えた見せ方: 新しいキーが先、古い「リスト／表」も読む", () => {
    expect(tabFromPrefs('"week"', '"table"')).toBe("week");
    expect(tabFromPrefs(null, '"table"')).toBe("table");
    expect(tabFromPrefs(null, '"list"')).toBe("day");
    expect(tabFromPrefs("junk", null)).toBeNull();
  });
});
