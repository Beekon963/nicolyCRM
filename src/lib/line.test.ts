import { describe, expect, it } from "vitest";
import { isMobileDevice, lineShareUrl } from "./line";

describe("LINEで送る", () => {
  it("文面を UTF-8 でパーセントエンコードする（改行・URL・記号も壊れない）", () => {
    const text = "山田さん\n10/10(土) DS駅前 & 集合9:30\nhttps://example.com/m/abc?x=1";
    const url = lineShareUrl(text);
    expect(url.startsWith("https://line.me/R/share?text=")).toBe(true);
    expect(decodeURIComponent(url.slice("https://line.me/R/share?text=".length))).toBe(text);
    expect(url).not.toContain("\n");
    expect(url).not.toContain(" ");
  });

  it("スマホ・タブレットの判定", () => {
    expect(isMobileDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(true);
    expect(isMobileDevice("Mozilla/5.0 (Linux; Android 15; Pixel 9)")).toBe(true);
    expect(isMobileDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5, "MacIntel")).toBe(true); // iPad
    expect(isMobileDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0, "MacIntel")).toBe(false);
    expect(isMobileDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
  });
});
