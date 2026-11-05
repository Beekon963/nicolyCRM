import { describe, expect, it } from "vitest";
import { parseCarrier } from "@/lib/carriers";
import { autoShortName, chipLabel } from "./short-name";

describe("稼働表の短い名前", () => {
  it("短い名前があればそれ、なければ会場名からチェーン名を外して先頭を使う", () => {
    expect(autoShortName("イオンモール架空村山")).toBe("架空村山");
    expect(autoShortName("ヨドバシカメラ 架空北店")).toBe("架空北店");
    expect(autoShortName("コジマ×ビックカメラ 架空店")).toBe("架空店");
    expect(autoShortName("架空店")).toBe("架空店");
    // 8文字より長いときは先頭6文字
    expect(autoShortName("架空エリア外販テレアポ拠点")).toBe("架空エリア外");
    expect(autoShortName("イオン")).toBe("イオン");
    expect(autoShortName("")).toBe("");
  });

  it("チップは「キャリア 場所」。キャリアが未設定・知らない値なら場所だけ", () => {
    expect(chipLabel({ venueName: "イオンモール架空村山", venueShort: "村山", carrier: "docomo" })).toBe("docomo 村山");
    expect(chipLabel({ venueName: "イオンモール架空村山", venueShort: "", carrier: "softbank" })).toBe("SoftBank 架空村山");
    expect(chipLabel({ venueName: "架空店", venueShort: null, carrier: "" })).toBe("架空店");
    expect(chipLabel({ venueName: "架空店", carrier: "unknown" })).toBe("架空店");
  });

  it("CSV のキャリアの書き方を直す", () => {
    expect(["docomo", "ドコモ", "au", "KDDI", "SoftBank", "ソフトバンク", "楽天モバイル", "", "謎"].map(parseCarrier)).toEqual(["docomo", "docomo", "au", "au", "softbank", "softbank", "rakuten", "", "other"]);
  });
});
