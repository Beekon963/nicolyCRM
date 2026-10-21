import { describe, expect, it } from "vitest";
import { colorDistance, contrastRatio, luminance, oklab } from "./color";
import { VENUE_COLOR_KEYS, VENUE_COLORS, venueColor, venueStyle } from "./venue-colors";

/** 状態の色（globals.css の -solid）。会場の色はこれらと見分けられないといけない */
const STATUS = { 赤: "#d92d20", 黄: "#fdb022", 緑: "#047857" };

describe("色の確かめ（src/lib/color）", () => {
  it("白と黒のコントラストは 21、同じ色は 1", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 0);
    expect(contrastRatio("#246cc2", "#246cc2")).toBe(1);
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
  });
  it("OKLab の白は L=1、黒は L=0。同じ色の距離は 0", () => {
    expect(oklab("#ffffff")[0]).toBeCloseTo(1, 2);
    expect(oklab("#000000")[0]).toBeCloseTo(0, 2);
    expect(colorDistance("#d92d20", "#d92d20")).toBe(0);
    expect(colorDistance("#ffffff", "#000000")).toBeGreaterThan(90);
  });
});

describe("会場の色（Phase 17: 稼働表はしっかり塗る）", () => {
  it("塗ったマスの文字は、地の上で 4.5:1 以上読める", () => {
    for (const k of VENUE_COLOR_KEYS) {
      const c = VENUE_COLORS[k];
      expect(contrastRatio(c.solid, c.on), `${k} の文字`).toBeGreaterThanOrEqual(4.5);
      // 薄い地の文字（ほかの画面）も読める
      expect(contrastRatio(c.tint, c.fg), `${k} の薄い地の文字`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("7色はどの2色も、ふつうの見え方ではっきり違う（OKLab で 15 以上）", () => {
    for (let i = 0; i < VENUE_COLOR_KEYS.length; i++)
      for (let j = i + 1; j < VENUE_COLOR_KEYS.length; j++) {
        const a = VENUE_COLOR_KEYS[i];
        const b = VENUE_COLOR_KEYS[j];
        expect(colorDistance(VENUE_COLORS[a].solid, VENUE_COLORS[b].solid), `${a} と ${b}`).toBeGreaterThanOrEqual(15);
      }
  });

  it("状態の色（赤 = 欠員、黄 = 打診中、緑 = そろった）とも見分けられる", () => {
    for (const k of VENUE_COLOR_KEYS)
      for (const [name, hex] of Object.entries(STATUS)) expect(colorDistance(VENUE_COLORS[k].solid, hex), `${k} と ${name}`).toBeGreaterThanOrEqual(15);
  });

  it("塗ったマスの上の札: 欠N・✓ は白い地に赤・緑の文字、打N は黄の地に濃い茶の文字で読める", () => {
    expect(contrastRatio("#ffffff", STATUS.赤)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#ffffff", STATUS.緑)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(STATUS.黄, "#4e1d09")).toBeGreaterThanOrEqual(4.5);
  });

  it("知らない色は青。マスの CSS 変数に塗りの色と文字の色が入る", () => {
    expect(venueColor("gold")).toBe(VENUE_COLORS.blue);
    expect(venueStyle("pink")).toMatchObject({ "--v-solid": "#dc719d", "--v-on": "#0f172a" });
  });
});
