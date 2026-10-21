import { describe, expect, it } from "vitest";
import { buildBoard } from "./index";
import { linkCss, shortageTileCount, venuesOf } from "./view";

const base = {
  month: "2026-11",
  today: "2026-11-05",
  holidays: {},
  staff: [{ id: "s1", name: "山田 太郎", kana: "やまだ", rank_name: "A", rank_order: 1, nearest_station: "" }],
  assignments: [],
  availability: [],
};
const ev = (id: string, date: string, venue: string, color: string, shortage: number, cancelled = false) => ({
  id,
  date,
  client_id: "c1",
  client_name: "テスト通信",
  venue_id: venue,
  venue_name: `会場${venue}`,
  venue_color: color,
  required_total: 2,
  confirmed_total: 2 - shortage,
  shortage_total: shortage,
  offered_count: 0,
  cancelled,
});

describe("会場のボタン・次の欠員へ（Phase 17）", () => {
  const board = buildBoard({ ...base, events: [ev("e1", "2026-11-05", "vA", "blue", 1), ev("e2", "2026-11-06", "vB", "pink", 0), ev("e3", "2026-11-07", "vB", "pink", 2), ev("e4", "2026-11-08", "vC", "sky", 0, true)] });

  it("この月に現場のある会場を、現場の多い順に出す（中止は数えない）", () => {
    expect(venuesOf(board)).toEqual([
      { id: "vB", name: "会場vB", color: "pink", events: 2 },
      { id: "vA", name: "会場vA", color: "blue", events: 1 },
    ]);
  });

  it("欠員のある現場のマスの数", () => {
    expect(shortageTileCount(board)).toBe(2);
    expect(shortageTileCount(buildBoard({ ...base, events: [] }))).toBe(0);
  });
});

describe("つながりの強調の CSS", () => {
  it("何も選んでいなければ空", () => {
    expect(linkCss("b1", null)).toBe("");
    expect(linkCss("b1", {})).toBe("");
  });

  it("現場を選ぶと: 同じ現場は光り、同じ会場は点線、ほかは薄く。その行の名前と日付の見出しに色", () => {
    const css = linkCss("b1", { event: "e1", venue: "vA", col: 5 });
    expect(css).toContain('[data-board="b1"] [data-event]:not([data-event="e1"]):not([data-venue="vA"]) { opacity: 0.28; }');
    expect(css).toContain('[data-venue="vA"]:not([data-event="e1"]) { outline: 2px dashed var(--v-on)');
    expect(css).toContain('[data-event="e1"] { position: relative; z-index: 2; box-shadow:');
    expect(css).toContain('tr:has([data-event="e1"]) > th[data-c="0"]');
    expect(css).toContain('thead th[data-c="5"]');
    // 動きは「動きを減らす」設定の人には出さない
    expect(css).toContain("@media (prefers-reduced-motion: no-preference)");
    // 欠員の現場でなければ、○の人は光らせない
    expect(css).not.toContain('[data-avail="ok"]');
  });

  it("欠員の現場を選ぶと、その日○で空いている人も光る", () => {
    const css = linkCss("b1", { event: "e3", venue: "vB", col: 7, short: true });
    expect(css).toContain('tr[data-kind="staff"] > td[data-c="7"] [data-avail="ok"] { opacity: 1; box-shadow: 0 0 0 3px var(--status-done-solid); }');
  });

  it("会場のボタンを押すと、その会場のマスだけが光る", () => {
    const css = linkCss("b1", { venue: "vB" });
    expect(css).toContain('[data-event]:not([data-venue="vB"]), [data-board="b1"] [data-avail] { opacity: 0.28; }');
    expect(css).toContain('[data-venue="vB"] { position: relative;');
    expect(css).not.toContain("data-event=\"");
  });
});
