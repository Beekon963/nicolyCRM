import { describe, expect, it } from "vitest";
import { datesFor, presetRanges } from "./bulk-dates";

describe("まとめて作成の日付", () => {
  it("10/1〜10/31 の土日", () => {
    const ds = datesFor("2026-10-01", "2026-10-31", ["土", "日"]);
    expect(ds).toEqual([
      "2026-10-03", "2026-10-04", "2026-10-10", "2026-10-11", "2026-10-17", "2026-10-18", "2026-10-24", "2026-10-25", "2026-10-31",
    ]);
  });

  it("「来週の土日」は次の月曜から始まる週の土日（今日が火曜 10/6）", () => {
    const p = presetRanges("2026-10-06")[0];
    expect(datesFor(p.from, p.to, p.weekdays)).toEqual(["2026-10-17", "2026-10-18"]);
  });

  it("今日が日曜でも「来週」は翌日からの週", () => {
    const p = presetRanges("2026-10-11")[0];
    expect(datesFor(p.from, p.to, p.weekdays)).toEqual(["2026-10-17", "2026-10-18"]);
  });

  it("期間が逆なら空", () => {
    expect(datesFor("2026-10-31", "2026-10-01", ["土"])).toEqual([]);
  });
});
