import { describe, expect, it } from "vitest";
import { interviewShareText, joinDays, slotsRequestText, slotsSummaryText } from "./messages";

// 架空の名前・会場
describe("案件の LINE の文", () => {
  it("日をまとめる", () => {
    expect(joinDays(["2026-11-14", "2026-11-15", "2026-11-14"])).toBe("14・15日");
    expect(joinDays(["2026-10-31", "2026-11-01"])).toBe("10/31・11/1");
    expect(joinDays([])).toBe("");
  });

  it("本人へ候補日のお願い（名前・取引先・日と会場・例の形）", () => {
    const t = slotsRequestText({ staffName: "検証 太郎", clientName: "アオゾラ通信", venues: ["架空モール軒先"], dates: ["2026-11-14", "2026-11-15"] });
    expect(t).toContain("検証 太郎さん");
    expect(t).toContain("アオゾラ通信の案件（14・15日 架空モール軒先）");
    expect(t).toContain("候補の日時を3つ");
    expect(t).toContain("10/26 20:00〜");
    expect(t).not.toMatch(/円|\d{2,4}-\d{2,4}-\d{4}/);
  });

  it("取引先へのまとめ（会場・日付・名前・候補日時の順。人数は2名以上のときだけ）", () => {
    const t = slotsSummaryText([
      { dates: ["2026-11-07"], venue: "架空モール", count: 1, staffName: "検証 太郎", slots: "10/27 15時以降\n10/28 12時まで" },
      { dates: ["2026-11-14", "2026-11-15"], venue: "架空モール軒先", count: 2, staffName: "試験 花子", slots: "10/22 〜18:00" },
    ]);
    expect(t).toBe(["7日 架空モール", "検証 太郎", "10/27 15時以降\n10/28 12時まで", "", "14・15日 架空モール軒先　2名", "試験 花子", "10/22 〜18:00", "", "お願いします！"].join("\n"));
  });

  it("本人へ面談日時の共有（日本時間で出す）", () => {
    const t = interviewShareText({ staffName: "検証 太郎", clientName: "アオゾラ通信", interviewAt: "2026-10-27T06:30:00Z", note: "https://example.com/meet（オンライン）" });
    expect(t).toContain("アオゾラ通信の面談は 10/27(火) 15:30〜 です。");
    expect(t).toContain("https://example.com/meet");
    expect(t.endsWith("当日はよろしくお願いします！")).toBe(true);
  });
});
