import { describe, expect, it } from "vitest";
import { itemLines, withProvisional } from "./items-bulk";

describe("獲得項目のまとめて登録", () => {
  it("見出しの行・空の行・同じ名前は使わない", () => {
    expect(itemLines("【ネクストウェーブ公認名称】\n\n獲得名\n・新規\n機種変更\n新規\n")).toEqual(["新規", "機種変更"]);
  });

  it("光・カードの項目だけ、すぐ下に（仮）を足す。もう（仮）があるものは足さない", () => {
    expect(withProvisional(["新規", "ドコモ光 1G", "ｄカードGOLD", "Pixel", "ドコモ光 10G", "ドコモ光 10G（仮）"])).toEqual([
      "新規",
      "ドコモ光 1G",
      "ドコモ光 1G（仮）",
      "ｄカードGOLD",
      "ｄカードGOLD（仮）",
      "Pixel",
      "ドコモ光 10G",
      "ドコモ光 10G（仮）",
    ]);
  });
});
