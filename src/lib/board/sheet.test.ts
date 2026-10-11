import { describe, expect, it } from "vitest";
import { buildBoard } from "./index";
import { boardToSheetValues, canOverwriteTab, sheetTitle } from "./sheet";

// 架空のデータ
const board = buildBoard({
  month: "2026-11",
  today: "2026-11-01",
  holidays: { "2026-11-03": "文化の日" },
  events: [
    { id: "e1", date: "2026-11-01", client_id: "c1", client_name: "テスト通信", venue_id: "v1", venue_name: "DSテスト中央", required_total: 2, confirmed_total: 1, shortage_total: 1, offered_count: 0, cancelled: false },
    { id: "e2", date: "2026-11-02", client_id: "c1", client_name: "テスト通信", venue_id: "v2", venue_name: "家電ストア架空", required_total: 1, confirmed_total: 1, shortage_total: 0, offered_count: 0, cancelled: false },
    { id: "e3", date: "2026-11-03", client_id: "c1", client_name: "テスト通信", venue_id: "v1", venue_name: "DSテスト中央", required_total: 1, confirmed_total: 0, shortage_total: 1, offered_count: 0, cancelled: true },
  ],
  staff: [{ id: "s1", name: "山田 太郎", kana: "やまだ", rank_name: "S", rank_order: 2, nearest_station: "架空駅" }],
  assignments: [
    { id: "a1", event_id: "e1", staff_id: "s1", role_id: "r", status: "confirmed" },
    { id: "a2", event_id: "e2", staff_id: "s1", role_id: "r", status: "offered" },
  ],
  availability: [
    { staff_id: "s1", date: "2026-11-01", status: "ok" },
    { staff_id: "s1", date: "2026-11-02", status: "maybe" },
    { staff_id: "s1", date: "2026-11-04", status: "ng" },
  ],
});

describe("スプレッドシートへの書き出し", () => {
  const rows = boardToSheetValues(board, "11/1 10:00");
  const col = (d: number) => 3 + d;

  it("タブ名は「CRM 202611」（手で作った「202611」のタブと重ならない）", () => {
    expect(sheetTitle("2026-11")).toBe("CRM 202611");
  });

  it("同じ名前のタブがあっても、左上が空か CRM が書いたものでなければ上書きしない", () => {
    expect(canOverwriteTab(rows[0][0])).toBe(true);
    expect(canOverwriteTab("")).toBe(true);
    expect(canOverwriteTab(undefined)).toBe(true);
    expect(canOverwriteTab("NICOLY")).toBe(false);
    expect(canOverwriteTab("最終更新 10/1（手で入力）")).toBe(false);
  });

  it("1・2行目は日付と曜日（祝日つき）。右端は稼働日数", () => {
    expect(rows[0].slice(0, 6)).toEqual(["最終更新 11/1 10:00（CRM から自動。ここで直しても CRM には戻りません）", "", "", "日付", "11/1", "11/2"]);
    expect(rows[0].at(-1)).toBe("稼働日数");
    expect(rows[1].slice(0, 4)).toEqual(["ランク", "名前", "最寄り駅", "曜日"]);
    expect(rows[1][col(3)]).toBe("火・祝");
    expect(rows.every((r) => r.length === rows[0].length)).toBe(true);
  });

  it("上の段: 取引先・会場ごとに「単価（空）/ 現場 / 人数（確定/必要）」の3行。中止はそう書く。その下に欠員", () => {
    expect(rows[2].slice(0, 4)).toEqual(["テスト通信", "", "", "単価"]);
    expect(rows[2].slice(4).every((v) => v === "")).toBe(true);
    expect(rows[3].slice(0, 4)).toEqual(["", "", "", "現場"]);
    expect(rows[3][col(1)]).toBe("DSテスト中央");
    expect(rows[3][col(3)]).toBe("DSテスト中央（中止）");
    expect(rows[4][col(1)]).toBe("1/2");
    expect(rows[4][col(3)]).toBe("");
    expect(rows[5].slice(0, 4)).toEqual(["", "", "", "単価"]);
    expect(rows[6].slice(0, 4)).toEqual(["", "", "", "現場"]);
    expect(rows[6][col(2)]).toBe("家電ストア架空");
    expect(rows[8].slice(0, 4)).toEqual(["", "", "", "欠員"]);
    expect(rows[8][col(1)]).toBe("1");
    expect(rows[8][col(3)]).toBe("");
  });

  it("下の段: 名前の行（単価・空）→ 場所（確定した場所だけ。打診中は書かない）→ シフト（⭕️🔺❌）。稼働日数を右端に", () => {
    const [name, place, shift] = rows.slice(9, 12);
    expect(name.slice(0, 4)).toEqual(["S", "山田 太郎", "架空駅", "単価"]);
    expect(name.at(-1)).toBe("1");
    expect(place.slice(0, 4)).toEqual(["", "", "", "場所"]);
    expect(place[col(1)]).toBe("DSテスト中央");
    expect(place[col(2)]).toBe("");
    expect([shift[col(1)], shift[col(2)], shift[col(3)], shift[col(4)]]).toEqual(["⭕️", "🔺", "", "❌"]);
  });

  it("金額は書き出さない（「単価」の行は並びをそろえるためだけで、中は空）", () => {
    const unitRows = rows.filter((r) => r[3] === "単価");
    expect(unitRows.length).toBeGreaterThan(0);
    expect(unitRows.every((r) => r.slice(4, -1).every((v) => v === ""))).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/売上|人件費|利益|¥|円/);
  });
});
