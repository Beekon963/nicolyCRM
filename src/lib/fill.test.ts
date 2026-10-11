import { describe, expect, it } from "vitest";
import { fillOf } from "./fill";

describe("埋まり具合", () => {
  it("必要人数のうち欠員を除いた人数と、割合（切り捨て）", () => {
    expect(fillOf([{ required: 3, shortage: 1 }, { required: 3, shortage: 0 }])).toEqual({ required: 6, shortage: 1, filled: 5, pct: 83 });
  });
  it("現場がない・必要人数が 0 のときは 100%", () => {
    expect(fillOf([])).toEqual({ required: 0, shortage: 0, filled: 0, pct: 100 });
  });
  it("欠員が必要人数より多いことはない（おかしな値は 0〜必要人数に収める）", () => {
    expect(fillOf([{ required: 2, shortage: 5 }]).pct).toBe(0);
    expect(fillOf([{ required: -1, shortage: -1 }])).toEqual({ required: 0, shortage: 0, filled: 0, pct: 100 });
  });
});
