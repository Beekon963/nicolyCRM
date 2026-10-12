import { describe, expect, it } from "vitest";
import { itemLines, withLater, withProvisional } from "./items-bulk";

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

  it("（後日）は、（仮）でない項目のすぐ下に足す。もう（後日）があるものは足さない", () => {
    expect(withLater(withProvisional(["新規", "ひかり", "カード（後日）", "カード"]))).toEqual(["新規", "新規（後日）", "ひかり", "ひかり（後日）", "カード（後日）", "カード", "カード（仮）"]);
  });
});
