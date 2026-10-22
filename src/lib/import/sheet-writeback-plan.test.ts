import { describe, expect, it } from "vitest";
import { layoutMonthSheet, type SheetLayout } from "./month-sheet";
import { DEFAULT_SYMBOLS, detectSymbols, planCellWrites } from "./sheet-writeback-plan";

/** 今のシートと同じ形（11月。上の段に取引先、下の段にスタッフ） */
function sheet(): { rows: string[][]; lay: SheetLayout } {
  const cols = Array.from({ length: 30 }, (_, i) => `11/${i + 1}`);
  const row = (head: string[], cells: Record<number, string> = {}) => {
    const r = Array<string>(4 + 30).fill("");
    head.forEach((v, i) => (r[i] = v));
    for (const [d, v] of Object.entries(cells)) r[3 + Number(d)] = v;
    return r;
  };
  const rows = [
    ["", "", "", "日付", ...cols, "出勤日数"],
    ["ランク", "名前", "最寄り駅", "曜日", ...cols.map(() => "月")],
    row(["アオゾラ通信（株）", "", "", "単価"], { 3: "¥20,000" }),
    row(["", "", "", "現場"], { 3: "DS大宮", 5: "知らないモール" }),
    row(["", "", "", "人数"], { 3: "2", 5: "1" }),
    row(["", "", "", "単価"]),
    row(["", "", "", "現場"], { 3: "DS浦和" }),
    row(["", "", "", "人数"], { 3: "1" }),
    row(["A", "検証 太郎", "大宮", "単価"], { 3: "¥15,000" }),
    row(["", "", "", "場所"], { 3: "DS大宮", 7: "よその現場" }),
    row(["", "", "", "シフト"], { 4: "⭕️", 5: "❌", 6: "○" }),
  ];
  const lay = layoutMonthSheet(rows);
  if ("error" in lay) throw new Error("layout");
  return { rows, lay };
}
const known = new Set(["ds大宮", "ds浦和", "ds船橋"]);
const d = (day: number) => `2026-11-${String(day).padStart(2, "0")}`;

describe("書き戻しのマスの決め方", () => {
  it("シートで使っている○△×の書き方を選ぶ（いちばん多いもの）", () => {
    const { rows, lay } = sheet();
    expect(detectSymbols(rows, lay)).toEqual({ ok: "⭕️", maybe: "🔺", ng: "❌" });
    expect(DEFAULT_SYMBOLS.maybe).toBe("🔺");
  });

  it("場所: 同じなら書かない、違えば書く、CRM になければ消す（合わない名前は触らない）", () => {
    const { rows, lay } = sheet();
    const r = planCellWrites(
      rows,
      lay,
      [
        { id: 1, kind: "staff_day", date: d(3), staffNames: ["検証 太郎"], venues: ["DS大宮"] },
        { id: 2, kind: "staff_day", date: d(4), staffNames: ["検証 太郎"], venues: ["DS浦和"] },
        { id: 3, kind: "staff_day", date: d(3), staffNames: ["検証 太郎"], venues: [] },
        { id: 4, kind: "staff_day", date: d(7), staffNames: ["検証 太郎"], venues: [] },
        { id: 5, kind: "staff_day", date: d(7), staffNames: ["検証 太郎"], venues: ["DS船橋"] },
        { id: 6, kind: "staff_day", date: d(3), staffNames: ["名簿にない 人"], venues: ["DS大宮"] },
      ],
      { symbols: DEFAULT_SYMBOLS, knownVenueKeys: known },
    );
    const by = Object.fromEntries(r.results.map((x) => [x.id, x]));
    expect(by[1].status).toBe("done");
    expect(by[1].message).toContain("変更なし");
    expect(by[2].message).toContain("「DS浦和」を書きました");
    expect(by[3].message).toContain("消しました");
    expect(by[4].status).toBe("skipped");
    expect(by[5].status).toBe("skipped");
    expect(by[6].status).toBe("failed");
    expect(by[6].message).toContain("行がありません");
    // 3日は id 3 の「消す」が最後なので空に、4日は DS浦和
    const placeRow = lay.staffBlocks[0].placeRow;
    expect(r.writes).toEqual(expect.arrayContaining([{ row: placeRow, col: 3 + 3, value: "" }, { row: placeRow, col: 3 + 4, value: "DS浦和" }]));
    expect(r.writes).toHaveLength(2);
  });

  it("シフト: シートの書き方で書く。消さない。読めない印は触らない", () => {
    const { rows, lay } = sheet();
    const r = planCellWrites(
      rows,
      lay,
      [
        { id: 1, kind: "availability", date: d(4), staffNames: ["検証 太郎"], status: "ok" },
        { id: 2, kind: "availability", date: d(4), staffNames: ["検証 太郎"], status: "ng" },
        { id: 3, kind: "availability", date: d(8), staffNames: ["検証 太郎"], status: "maybe" },
        { id: 4, kind: "availability", date: d(5), staffNames: ["検証 太郎"], status: null },
        { id: 5, kind: "availability", date: d(9), staffNames: ["検証 太郎"], status: null },
      ],
      { symbols: { ok: "⭕️", maybe: "🔺", ng: "❌" }, knownVenueKeys: known },
    );
    const by = Object.fromEntries(r.results.map((x) => [x.id, x]));
    expect(by[1].message).toContain("変更なし");
    expect(by[2].message).toContain("「❌」を書きました");
    expect(by[3].message).toContain("「🔺」を書きました");
    expect(by[4].status).toBe("skipped");
    expect(by[5].status).toBe("done");
    const shiftRow = lay.staffBlocks[0].shiftRow;
    expect(r.writes).toEqual(expect.arrayContaining([{ row: shiftRow, col: 3 + 4, value: "❌" }, { row: shiftRow, col: 3 + 8, value: "🔺" }]));
  });

  it("現場・人数: 書いてある枠はそのまま（人数だけ合わせる）、空いている枠に足す、CRM にない現場は消す、枠が足りなければ知らせる", () => {
    const { rows, lay } = sheet();
    const r = planCellWrites(
      rows,
      lay,
      [
        { id: 1, kind: "client_day", date: d(3), clientNames: ["株式会社アオゾラ通信"], events: [{ venue: "DS大宮", required: 3 }, { venue: "DS浦和", required: 1 }] },
        { id: 2, kind: "client_day", date: d(4), clientNames: ["株式会社アオゾラ通信"], events: [{ venue: "DS船橋", required: 2 }] },
        { id: 3, kind: "client_day", date: d(5), clientNames: ["株式会社アオゾラ通信"], events: [] },
        { id: 4, kind: "client_day", date: d(6), clientNames: ["株式会社アオゾラ通信"], events: [{ venue: "DS大宮", required: 1 }, { venue: "DS浦和", required: 1 }, { venue: "DS船橋", required: 1 }] },
        { id: 5, kind: "client_day", date: d(3), clientNames: ["知らない商事"], events: [{ venue: "DS大宮", required: 1 }] },
      ],
      { symbols: DEFAULT_SYMBOLS, knownVenueKeys: known },
    );
    const by = Object.fromEntries(r.results.map((x) => [x.id, x]));
    expect(by[1].status).toBe("done");
    expect(by[1].message).toContain("人数を 3 に");
    expect(by[2].message).toContain("「DS船橋」（2人）を書きました");
    expect(by[3].message).toContain("合わないので触りません");
    expect(by[4].status).toBe("failed");
    expect(by[4].message).toContain("枠がありません");
    expect(by[5].status).toBe("failed");
    const [b1, b2] = lay.clientBlocks;
    expect(r.writes).toEqual(
      expect.arrayContaining([
        { row: b1.countRow, col: 3 + 3, value: "3" },
        { row: b1.venueRow, col: 3 + 4, value: "DS船橋" },
        { row: b1.countRow, col: 3 + 4, value: "2" },
        { row: b1.venueRow, col: 3 + 6, value: "DS大宮" },
        { row: b2.venueRow, col: 3 + 6, value: "DS浦和" },
      ]),
    );
    // 5日の「知らないモール」は触らない
    expect(r.writes.find((w) => w.col === 3 + 5)).toBeUndefined();
  });

  it("その日の列がシートにないときは知らせる", () => {
    const { rows, lay } = sheet();
    const r = planCellWrites(rows, lay, [{ id: 1, kind: "staff_day", date: "2026-11-31", staffNames: ["検証 太郎"], venues: [] }], { symbols: DEFAULT_SYMBOLS, knownVenueKeys: known });
    expect(r.results[0].status).toBe("failed");
  });
});
