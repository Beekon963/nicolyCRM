import { describe, expect, it } from "vitest";
import { clampZoom, keepFocus, stepZoom, ZOOM_MAX, ZOOM_MIN, zoomLabel } from "./zoom";

describe("稼働表の拡大・縮小", () => {
  it("倍率は 25%〜200% に収める", () => {
    expect(clampZoom(0.1)).toBe(ZOOM_MIN);
    expect(clampZoom(5)).toBe(ZOOM_MAX);
    expect(clampZoom(0.8333)).toBe(0.83);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it("＋ / − は決まった刻みで進み、端では止まる", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(2, 1)).toBe(2);
    expect(stepZoom(0.25, -1)).toBe(0.25);
  });

  it("指で変えた半端な倍率からでも、次の刻みに進む", () => {
    expect(stepZoom(0.8, 1)).toBe(0.9);
    expect(stepZoom(0.8, -1)).toBe(0.75);
  });

  it("倍率の表示", () => {
    expect(zoomLabel(0.67)).toBe("67%");
    expect(zoomLabel(1)).toBe("100%");
  });

  it("指の下のマスが同じ場所に残るようにスクロールする", () => {
    // 100px スクロールした状態で、枠の左から 50px の所を中心に 2 倍にすると、その点（表の 150px）は 300px に動く
    expect(keepFocus(100, 50, 1, 2)).toBe(250);
    // 縮めると戻る
    expect(keepFocus(250, 50, 2, 1)).toBe(100);
    // 左端より前には行かない
    expect(keepFocus(0, 10, 1, 0.5)).toBe(0);
  });
});
