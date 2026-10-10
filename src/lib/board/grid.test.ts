import { describe, expect, it } from "vitest";
import {
  applyAvailability,
  availabilityChanges,
  availabilityFromKey,
  cellText,
  clampWidth,
  DAY_WIDTH,
  gridColCount,
  gridRows,
  moveSelection,
  nextDensity,
  normRange,
  reverseChanges,
  selectionTsv,
  single,
} from "./grid";
import { buildBoard, type BoardInput } from "./index";

const input: BoardInput = {
  month: "2026-11",
  today: "2026-11-03",
  holidays: {},
  events: [
    {
      id: "e1",
      date: "2026-11-02",
      client_id: "c1",
      client_name: "テスト通信",
      venue_id: "v1",
      venue_name: "DSテスト中央",
      required_total: 2,
      confirmed_total: 1,
      shortage_total: 1,
      offered_count: 1,
      cancelled: false,
    },
  ],
  staff: [
    { id: "s1", name: "青木 一郎", kana: "あおき", rank_name: "A", rank_order: 1, nearest_station: "新宿駅" },
    { id: "s2", name: "井上 花子", kana: "いのうえ", rank_name: "B", rank_order: 2, nearest_station: "" },
  ],
  assignments: [
    { id: "a1", event_id: "e1", staff_id: "s1", role_id: "r1", status: "confirmed" },
    { id: "a2", event_id: "e1", staff_id: "s2", role_id: "r1", status: "offered" },
  ],
  availability: [
    { staff_id: "s1", date: "2026-11-01", status: "ok" },
    { staff_id: "s2", date: "2026-11-01", status: "ng" },
    { staff_id: "s2", date: "2026-11-03", status: "maybe" },
  ],
};
const board = buildBoard(input);
const rows = gridRows(board);
const cols = gridColCount(board);

describe("稼働表のマスの番地", () => {
  it("行は 日付 → 欠員 → 取引先 → スタッフ、列は 名前 → 各日 → 稼働日数", () => {
    expect(rows.map((r) => r.kind)).toEqual(["header", "shortage", "client", "staff", "staff"]);
    expect(cols).toBe(32);
  });
  it("現場がない月は、欠員と取引先の行がない", () => {
    expect(gridRows(buildBoard({ ...input, events: [], assignments: [] })).map((r) => r.kind)).toEqual(["header", "staff", "staff"]);
  });
});

describe("キーでの移動（スプレッドシートと同じ）", () => {
  const o = { rows: rows.length, cols };
  it("矢印で1マスずつ動き、表の外には出ない", () => {
    expect(moveSelection(single({ r: 2, c: 3 }), "ArrowDown", o).focus).toEqual({ r: 3, c: 3 });
    expect(moveSelection(single({ r: 0, c: 0 }), "ArrowUp", o).focus).toEqual({ r: 0, c: 0 });
    expect(moveSelection(single({ r: 4, c: 31 }), "ArrowRight", o).focus).toEqual({ r: 4, c: 31 });
  });
  it("Shift で範囲を広げ、Ctrl で端まで飛ぶ", () => {
    const s = moveSelection(single({ r: 3, c: 1 }), "ArrowRight", { ...o, shift: true });
    expect(s).toEqual({ anchor: { r: 3, c: 1 }, focus: { r: 3, c: 2 } });
    expect(moveSelection(single({ r: 3, c: 5 }), "ArrowRight", { ...o, jump: true }).focus).toEqual({ r: 3, c: 31 });
    expect(moveSelection(single({ r: 3, c: 5 }), "ArrowUp", { ...o, jump: true }).focus).toEqual({ r: 0, c: 5 });
  });
  it("Home / End は行の最初・最後、PageDown は10行先（最後で止まる）", () => {
    expect(moveSelection(single({ r: 3, c: 5 }), "Home", o).focus).toEqual({ r: 3, c: 0 });
    expect(moveSelection(single({ r: 3, c: 5 }), "End", o).focus).toEqual({ r: 3, c: 31 });
    expect(moveSelection(single({ r: 1, c: 5 }), "PageDown", o).focus).toEqual({ r: 4, c: 5 });
  });
  it("範囲は左上と右下にそろえる", () => {
    expect(normRange({ anchor: { r: 4, c: 3 }, focus: { r: 2, c: 1 } })).toEqual({ r1: 2, r2: 4, c1: 1, c2: 3 });
  });
});

describe("コピー", () => {
  it("マスの文字は画面と同じ言葉（現場は 会場 確定/必要、打診中は「打」）", () => {
    expect(cellText(board, rows[0], 2)).toBe("2(月)");
    expect(cellText(board, rows[1], 2)).toBe("1人");
    expect(cellText(board, rows[2], 2)).toBe("DSテスト中央 1/2");
    expect(cellText(board, rows[3], 2)).toBe("DSテスト中央");
    expect(cellText(board, rows[4], 2)).toBe("打 DSテスト中央");
    expect(cellText(board, rows[4], 1)).toBe("×");
    expect(cellText(board, rows[3], 31)).toBe("1");
  });
  it("範囲をタブ区切りにする", () => {
    expect(selectionTsv(board, rows, { anchor: { r: 0, c: 0 }, focus: { r: 4, c: 3 } })).toBe(
      ["日付\t1(日)\t2(月)\t3(火)", "欠員\t\t1人\t", "テスト通信\t\tDSテスト中央 1/2\t", "青木 一郎\t○\tDSテスト中央\t", "井上 花子\t×\t打 DSテスト中央\t△"].join("\n"),
    );
  });
});

describe("キーで稼働可能日を入れる", () => {
  it("1 / 2 / 3（o・x も可）で ○△×、Delete で消す。ほかのキーは入れない", () => {
    expect(availabilityFromKey("1")).toBe("ok");
    expect(availabilityFromKey("o")).toBe("ok");
    expect(availabilityFromKey("2")).toBe("maybe");
    expect(availabilityFromKey("x")).toBe("ng");
    expect(availabilityFromKey("Backspace")).toBeNull();
    expect(availabilityFromKey("a")).toBeUndefined();
    expect(availabilityFromKey("Enter")).toBeUndefined();
  });
  it("範囲のうちスタッフ × 日のマスだけが対象。もともと同じ値のマスは変えない", () => {
    const changes = availabilityChanges(board, rows, { anchor: { r: 0, c: 0 }, focus: { r: 4, c: 3 } }, "ok");
    expect(changes).toEqual([
      { staffId: "s1", date: "2026-11-02", status: "ok", previous: null },
      { staffId: "s1", date: "2026-11-03", status: "ok", previous: null },
      { staffId: "s2", date: "2026-11-01", status: "ok", previous: "ng" },
      { staffId: "s2", date: "2026-11-02", status: "ok", previous: null },
      { staffId: "s2", date: "2026-11-03", status: "ok", previous: "maybe" },
    ]);
  });
  it("元に戻すときは前の値に戻す", () => {
    expect(reverseChanges([{ staffId: "s2", date: "2026-11-01", status: "ok", previous: "ng" }])).toEqual([
      { staffId: "s2", date: "2026-11-01", status: "ng", previous: "ok" },
    ]);
  });
  it("保存が終わる前でも画面にすぐ出す（予定はそのまま残す）", () => {
    const b = applyAvailability(board, [
      { staffId: "s1", date: "2026-11-02", status: "ng" },
      { staffId: "s2", date: "2026-11-01", status: null },
    ]);
    expect(b.staff[0].cells["2026-11-02"]).toMatchObject({ availability: "ng", assignments: [{ id: "a1" }] });
    expect(b.staff[1].cells["2026-11-01"].availability).toBeNull();
    expect(board.staff[1].cells["2026-11-01"].availability).toBe("ng");
  });
});

describe("列の幅・行の高さ", () => {
  it("幅は決まった範囲に収める", () => {
    expect(clampWidth(10, DAY_WIDTH)).toBe(40);
    expect(clampWidth(999, DAY_WIDTH)).toBe(240);
    expect(clampWidth(87.6, DAY_WIDTH)).toBe(88);
  });
  it("行の高さは 中 → 小 → 大 → 中 の順に切り替える", () => {
    expect(nextDensity("normal")).toBe("small");
    expect(nextDensity("small")).toBe("large");
    expect(nextDensity("large")).toBe("normal");
  });
});
