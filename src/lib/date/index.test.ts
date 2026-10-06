import { describe, expect, it } from "vitest";
import {
  addDays,
  diffDays,
  eachDay,
  formatLongJa,
  formatShortJa,
  formatTimeJst,
  holidayName,
  isDateString,
  isHoliday,
  jstToInstant,
  monthRange,
  nextMonth,
  todayJst,
  tomorrowJst,
  weekdayJa,
} from "./index";

describe("テスト環境", () => {
  it("サーバーと同じく UTC で動いている（vitest.config.ts で TZ=UTC）", () => {
    expect(new Date("2026-10-06T15:00:00Z").getHours()).toBe(15);
  });
});

describe("日本時間の0時前後で「今日」「明日」がずれない（受け入れテスト）", () => {
  it("JST 23:59:59（UTC 14:59:59）はまだ当日", () => {
    const now = new Date("2026-10-06T14:59:59Z");
    expect(todayJst(now)).toBe("2026-10-06");
    expect(tomorrowJst(now)).toBe("2026-10-07");
  });

  it("JST 0:00:00（UTC 15:00:00）で翌日に切り替わる", () => {
    const now = new Date("2026-10-06T15:00:00Z");
    expect(todayJst(now)).toBe("2026-10-07");
    expect(tomorrowJst(now)).toBe("2026-10-08");
  });

  it("UTC では前日でも JST では当日（朝 8:59 JST = UTC 前日 23:59）", () => {
    const now = new Date("2026-10-05T23:59:00Z");
    expect(todayJst(now)).toBe("2026-10-06");
  });

  it("月末・年末をまたぐ", () => {
    expect(todayJst(new Date("2026-10-31T15:00:00Z"))).toBe("2026-11-01");
    expect(todayJst(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
    expect(tomorrowJst(new Date("2026-12-31T14:59:59Z"))).toBe("2027-01-01");
  });
});

describe("暦日の計算", () => {
  it("addDays はうるう年・月末を正しく扱う", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDays("2026-10-01", -1)).toBe("2026-09-30");
    expect(addDays("2026-10-06", 7)).toBe("2026-10-13");
  });

  it("diffDays / eachDay", () => {
    expect(diffDays("2026-10-01", "2026-10-31")).toBe(30);
    expect(eachDay("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
    expect(eachDay("2026-10-02", "2026-10-01")).toEqual([]);
  });

  it("月の範囲と翌月", () => {
    expect(monthRange("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthRange("2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(nextMonth("2026-12")).toBe("2027-01");
  });

  it("不正な日付は弾く", () => {
    expect(isDateString("2026-02-30")).toBe(false);
    expect(isDateString("2026/10/06")).toBe(false);
    expect(isDateString("2026-10-06")).toBe(true);
    expect(() => addDays("2026-13-01", 1)).toThrow();
  });
});

describe("曜日・祝日・表示", () => {
  it("曜日", () => {
    expect(weekdayJa("2026-10-06")).toBe("火");
    expect(weekdayJa("2026-10-10")).toBe("土");
  });

  it("祝日（サーバーが UTC でもずれない）", () => {
    expect(holidayName("2026-11-03")).toBe("文化の日");
    expect(isHoliday("2026-10-12")).toBe(true); // スポーツの日
    expect(isHoliday("2026-10-13")).toBe(false);
  });

  it("表示形式", () => {
    expect(formatShortJa("2026-10-06")).toBe("10/6(火)");
    expect(formatLongJa("2026-10-06")).toBe("2026年10月6日(火)");
  });
});

describe("日本時間の時刻 ⇔ 瞬間", () => {
  it("JST 9:30 は UTC 0:30", () => {
    expect(jstToInstant("2026-10-06", "09:30").toISOString()).toBe("2026-10-06T00:30:00.000Z");
    expect(formatTimeJst(new Date("2026-10-06T00:30:00Z"))).toBe("09:30");
  });

  it("JST 0:30 は UTC 前日 15:30", () => {
    expect(jstToInstant("2026-10-07", "00:30").toISOString()).toBe("2026-10-06T15:30:00.000Z");
  });
});
