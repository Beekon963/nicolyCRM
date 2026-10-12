import { describe, expect, it } from "vitest";
import { countHundredths, formatCount, isCount, roundCount, splitCount, sumCounts } from "./count";

describe("件数（小数第2位まで）", () => {
  it("人数で割る: 合計が元の件数になる", () => {
    expect(splitCount(1, 2)).toEqual([0.5, 0.5]);
    expect(splitCount(1, 3)).toEqual([0.34, 0.33, 0.33]);
    expect(splitCount(3, 2)).toEqual([1.5, 1.5]);
    expect(splitCount(2, 3)).toEqual([0.67, 0.67, 0.66]);
    expect(sumCounts(splitCount(1, 3))).toBe(1);
    expect(splitCount(1, 0)).toEqual([]);
  });

  it("合計に足し算の誤差が出ない", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumCounts([0.1, 0.2])).toBe(0.3);
    expect(sumCounts([0.34, 0.33, 0.33, null, undefined])).toBe(1);
    expect(roundCount(0.6600000000000001)).toBe(0.66);
  });

  it("画面の形と、0.01件単位の整数", () => {
    expect(formatCount(2)).toBe("2");
    expect(formatCount(0.5)).toBe("0.5");
    expect(formatCount(1 / 3)).toBe("0.33");
    expect(countHundredths(0.33)).toBe(33);
    expect(countHundredths(0.9999999999)).toBe(100);
  });

  it("件数として正しいか", () => {
    expect(isCount(0.5)).toBe(true);
    expect(isCount(0.33)).toBe(true);
    expect(isCount(3)).toBe(true);
    expect(isCount(0.333)).toBe(false);
    expect(isCount(-1)).toBe(false);
    expect(isCount(Number.NaN)).toBe(false);
  });
});
