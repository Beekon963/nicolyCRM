import { describe, expect, it } from "vitest";
import type { ParsedMonthSheet } from "./month-sheet";
import { buildPlan, type PlanContext } from "./month-sheet-plan";
import { autoChoices, mergeUnmatched, publicCsvUrl, syncMonths, tabTitle, vanished } from "./sheet-sync-plan";

const ctx: PlanContext = {
  today: "2026-10-22",
  clients: [{ id: "c1", name: "株式会社アオゾラ通信" }],
  venues: [
    { id: "v1", name: "DSサンプル大宮西口" },
    { id: "v2", name: "研修センター" },
  ],
  staff: [
    { id: "s1", name: "検証 太郎" },
    { id: "s2", name: "検証 花子" },
  ],
  events: [],
};

const parsed: ParsedMonthSheet = {
  month: 11,
  days: [1, 2, 3],
  warnings: [],
  clients: [
    {
      name: "アオゾラ通信（株）",
      lines: [
        { day: 1, venue: "DSサンプル大宮西口", required: 2, rate: null, transport: false },
        { day: 2, venue: "ないモール", required: 1, rate: null, transport: false },
      ],
    },
    { name: "知らない商事", lines: [{ day: 3, venue: "DSサンプル大宮西口", required: 1, rate: null, transport: false }] },
  ],
  staff: [
    { rank: "A", name: "検証 太郎", station: "", places: [{ day: 1, place: "DSサンプル大宮西口" }], shifts: [{ day: 2, status: "ok" }], rates: [] },
    { rank: "B", name: "検証 花子", station: "", places: [{ day: 3, place: "研修センター" }], shifts: [], rates: [] },
    { rank: "", name: "名簿にない 人", station: "", places: [], shifts: [{ day: 1, status: "ng" }], rates: [] },
    { rank: "", name: "空の 行", station: "", places: [], shifts: [], rates: [] },
  ],
};

describe("シートの自動の読み取りの計算", () => {
  it("今月と来月のタブを読む", () => {
    expect(syncMonths("2026-10-22")).toEqual(["2026-10", "2026-11"]);
    expect(syncMonths("2026-12-31")).toEqual(["2026-12", "2027-01"]);
    expect(tabTitle("2026-11")).toBe("202611");
  });

  it("リンク共有のシートを CSV で読む URL", () => {
    expect(publicCsvUrl("abc 1", "202611")).toBe("https://docs.google.com/spreadsheets/d/abc%201/gviz/tq?tqx=out:csv&sheet=202611");
    expect(publicCsvUrl("abc", "202611", "http://127.0.0.1:4012")).toMatch(/^http:\/\/127\.0\.0\.1:4012\/spreadsheets/);
  });

  it("名前が同じものは自動で選び、合わないものは作らずに「合わない名前」に出す", () => {
    const r = autoChoices(parsed, ctx, "2026-11", []);
    expect(r.unmatched).toEqual({
      clients: ["知らない商事"],
      venues: ["ないモール"],
      staff: ["名簿にない 人"],
      places: [{ place: "研修センター", days: [3] }],
    });
    const plan = buildPlan(r.parsed, ctx, r.choices);
    expect(plan.newClients).toEqual([]);
    expect(plan.newVenues).toEqual([]);
    expect(plan.events.map((e) => `${e.date} ${e.venueName} ${e.required}`)).toEqual(["2026-11-01 DSサンプル大宮西口 2"]);
    expect(plan.assignments).toEqual([{ eventKey: plan.events[0].key, staffId: "s1", dailyRate: null }]);
    expect(plan.availability).toEqual([{ staffId: "s1", date: "2026-11-02", status: "ok" }]);
  });

  it("覚えた対応づけを当てると、次からは自動で入る（取り込まない も覚える）", () => {
    const r = autoChoices(parsed, ctx, "2026-11", [
      { kind: "client", sheet_name: "知らない商事", target_id: "c1" },
      { kind: "venue", sheet_name: "ないモール", target_id: "v1" },
      { kind: "staff", sheet_name: "名簿にない 人", target_id: null },
      { kind: "place", sheet_name: "研修センター", target_id: "c1" },
    ]);
    expect(r.unmatched).toEqual({ clients: [], venues: [], staff: [], places: [] });
    const plan = buildPlan(r.parsed, ctx, r.choices);
    expect(plan.events.map((e) => `${e.date} ${e.venueName} ${e.required}`).sort()).toEqual([
      "2026-11-01 DSサンプル大宮西口 2",
      "2026-11-02 DSサンプル大宮西口 1",
      "2026-11-03 DSサンプル大宮西口 1",
      "2026-11-03 研修センター 1",
    ]);
    expect(plan.assignments.map((a) => a.staffId).sort()).toEqual(["s1", "s2"]);
    // 取り込まない にした人の稼働可能日は入らない
    expect(plan.availability.map((a) => a.staffId)).toEqual(["s1"]);
  });

  it("対応づけの先がもうないときは無視する（合わない名前に戻る）", () => {
    const r = autoChoices(parsed, ctx, "2026-11", [{ kind: "client", sheet_name: "知らない商事", target_id: "c-deleted" }]);
    expect(r.unmatched.clients).toEqual(["知らない商事"]);
  });

  it("台帳にあってシートにないものを出す・合わない名前をまとめる", () => {
    expect(vanished([{ key: "a" }, { key: "b" }], ["b"])).toEqual([{ key: "a" }]);
    expect(
      mergeUnmatched(
        { clients: ["x"], venues: [], staff: ["s"], places: [{ place: "p", days: [1] }] },
        { clients: ["x", "y"], venues: ["v"], staff: [], places: [{ place: "p", days: [2] }] },
      ),
    ).toEqual({ clients: ["x", "y"], venues: ["v"], staff: ["s"], places: [{ place: "p", days: [1, 2] }] });
  });
});
