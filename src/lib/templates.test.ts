import { describe, expect, it } from "vitest";
import { formatTime, formatTimeRange, renderTemplate } from "./templates";

describe("文面テンプレートの差し込み", () => {
  it("差し込み項目を値に置き換える", () => {
    expect(renderTemplate("{名前}さん\n{日付}({曜日}) {会場名}", { 名前: "山田", 日付: "10/10", 曜日: "土", 会場名: "DS駅前" })).toBe(
      "山田さん\n10/10(土) DS駅前",
    );
  });

  it("値がない項目は空になり、行末の空白は消える", () => {
    expect(renderTemplate("集合 {集合時刻} {集合場所}", { 集合時刻: "9:30" })).toBe("集合 9:30");
  });

  it("知らない {…} はそのまま残す", () => {
    expect(renderTemplate("{不明} {名前}", { 名前: "山田" })).toBe("{不明} 山田");
  });

  it("同じ項目が何回出てきても置き換える", () => {
    expect(renderTemplate("{名前}/{名前}", { 名前: "A" })).toBe("A/A");
  });
});

describe("時刻の表示", () => {
  it("秒を落とし、時の先頭の0を取る", () => {
    expect(formatTime("09:30:00")).toBe("9:30");
    expect(formatTime("10:00")).toBe("10:00");
    expect(formatTime(null)).toBe("");
    expect(formatTimeRange("10:00:00", "19:00:00")).toBe("10:00〜19:00");
  });
});
