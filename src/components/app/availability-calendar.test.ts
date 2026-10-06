import { describe, expect, it } from "vitest";
import { nextStatus } from "./availability-calendar";

describe("稼働可能日のタップ", () => {
  it("○ → △ → × → 未入力 → ○ と切り替わる", () => {
    expect(nextStatus(undefined)).toBe("ok");
    expect(nextStatus("ok")).toBe("maybe");
    expect(nextStatus("maybe")).toBe("ng");
    expect(nextStatus("ng")).toBe(null);
    expect(nextStatus(null)).toBe("ok");
  });
});
