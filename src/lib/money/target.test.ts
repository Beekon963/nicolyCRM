import { describe, expect, it } from "vitest";
import { targetProgress } from "./index";

describe("目標との比較", () => {
  it("届いていないときは、あと何円かと何%か（1%未満切り捨て）", () => {
    expect(targetProgress(540_000, 1_000_000)).toEqual({ pct: 54, remaining: 460_000, reached: false });
    expect(targetProgress(999_999, 1_000_000)).toEqual({ pct: 99, remaining: 1, reached: false });
  });
  it("届いたら残りは 0、100% を超えてもそのまま出す", () => {
    expect(targetProgress(1_000_000, 1_000_000)).toEqual({ pct: 100, remaining: 0, reached: true });
    expect(targetProgress(10_650_000, 1_000_000)).toEqual({ pct: 1065, remaining: 0, reached: true });
  });
  it("赤字（マイナス）のときは % を出さない", () => {
    expect(targetProgress(-49_890_000, 1_000_000)).toEqual({ pct: null, remaining: 50_890_000, reached: false });
  });
  it("目標が 0 以下のときは % を出さない", () => {
    expect(targetProgress(100, 0)).toEqual({ pct: null, remaining: 0, reached: true });
  });
});
