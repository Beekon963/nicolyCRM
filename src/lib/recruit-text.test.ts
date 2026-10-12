import { describe, expect, it } from "vitest";
import { matchVenue, minutesBefore, parseRecruitText } from "./recruit-text";

const ROLES = ["クローザー", "キャッチャー"];
const today = "2026-10-12";

describe("取引先の募集の文を読む", () => {
  it("■見出しの形（稼働場所・募集ポジション・〈募集日〉〈優遇日〉・稼働時間）を読める", () => {
    const text = [
      "———————",
      "① docomo｜〇〇モール 外販イベント",
      "———————",
      "",
      "■稼働期間",
      "11月",
      "",
      "■稼働場所",
      "〇〇モール",
      "",
      "■募集ポジション・人数",
      "クローザー：各日1名",
      "",
      "■稼働日・時間",
      "〈募集日〉",
      "11/1・5・6・10・11・13・",
      "14・15・16・20・23・24・",
      "28・29・30",
      "",
      "〈優遇日〉",
      "11/5・6・10・11・13・14・",
      "15・16・24に稼働可能な方を優遇いたします。",
      "",
      "稼働時間：11時〜19時(うち1時間休憩)",
      "",
      "■業務内容・応募条件",
      "・docomo外販イベントでのクローザー業務",
    ].join("\n");
    const p = parseRecruitText(text, { today, roleNames: ROLES });
    expect(p.dates.map((d) => Number(d.slice(8)))).toEqual([1, 5, 6, 10, 11, 13, 14, 15, 16, 20, 23, 24, 28, 29, 30]);
    expect(p.dates.every((d) => d.startsWith("2026-11-"))).toBe(true);
    expect(p.starred.map((d) => Number(d.slice(8)))).toEqual([5, 6, 10, 11, 13, 14, 15, 16, 24]);
    expect(p.venue).toBe("〇〇モール");
    expect([p.start, p.end]).toEqual(["11:00", "19:00"]);
    expect(p.roles).toEqual([{ name: "クローザー", count: 1 }]);
  });

  it("「11/22に稼働可能な方を優遇」のように、日付のあとに文が続いても読む。年つきの日付も読む", () => {
    const p = parseRecruitText("〈募集日〉11/21・22\n〈優遇日〉\n11/22に稼働可能な方を優遇いたします。\n日程：2026/11/23", { today, roleNames: ROLES });
    expect(p.dates).toEqual(["2026-11-21", "2026-11-22", "2026-11-23"]);
    expect(p.starred).toEqual(["2026-11-22"]);
  });

  it("1行に並んだ日付（LINE で折り返していないとき）も同じに読む", () => {
    const p = parseRecruitText("〈募集日〉11/1・5・6・10\n〈優遇日〉11/5・6に稼働可能な方を優遇", { today, roleNames: ROLES });
    expect(p.dates).toEqual(["2026-11-01", "2026-11-05", "2026-11-06", "2026-11-10"]);
    expect(p.starred).toEqual(["2026-11-05", "2026-11-06"]);
  });

  it("緊急募集の形（▼会場・日程・募集・時間）を読める。「※2名体制」は人数にしない。金額は読まない", () => {
    const text = [
      "@All",
      "お世話になります！",
      "上記、本日は埋まりましたが明日がまだ欠員になっておりまして、、、",
      "",
      "【🙇緊急募集🙇】",
      "",
      "▼〇〇Style △△モール TOKYO",
      "単価：27,000円込〜",
      "日程：10/12(月/祝)",
      "募集：クローザー1名",
      "※クローザー2名体制",
      "時間：10:30-18:30",
    ].join("\n");
    const p = parseRecruitText(text, { today, roleNames: ROLES });
    expect(p.dates).toEqual(["2026-10-12"]);
    expect(p.starred).toEqual([]);
    expect(p.venue).toBe("〇〇Style △△モール TOKYO");
    expect([p.start, p.end]).toEqual(["10:30", "18:30"]);
    expect(p.roles).toEqual([{ name: "クローザー", count: 1 }]);
  });

  it("「11月5日」「11/1〜11/3」「場所：」の書き方、複数の役割", () => {
    const p = parseRecruitText("場所：△△駅前\n日程：11月5日、11/1〜11/3\n10時半〜18時\nクローザー2名、キャッチャー1名", { today, roleNames: ROLES });
    expect(p.dates).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-05"]);
    expect(p.venue).toBe("△△駅前");
    expect([p.start, p.end]).toEqual(["10:30", "18:00"]);
    expect(p.roles).toEqual([
      { name: "クローザー", count: 2 },
      { name: "キャッチャー", count: 1 },
    ]);
  });

  it("年をまたぐ募集は来年の日付にする。人数・時間の数字は日付にしない", () => {
    const p = parseRecruitText("日程：1/5・6\n各日2名\n11時〜19時(うち1時間休憩)", { today: "2026-12-20", roleNames: ROLES });
    expect(p.dates).toEqual(["2027-01-05", "2027-01-06"]);
  });

  it("日付がなければ空", () => {
    expect(parseRecruitText("よろしくお願いします", { today, roleNames: ROLES })).toMatchObject({ dates: [], venue: "", start: null, roles: [] });
  });
});

describe("会場を探す・集合時刻", () => {
  const venues = [
    { id: "1", name: "△△モール TOKYO" },
    { id: "2", name: "〇〇モール" },
    { id: "3", name: "△△モール" },
  ];
  it("同じ名前 → 含む名前のうち長いもの", () => {
    expect(matchVenue("〇〇モール", venues)?.id).toBe("2");
    expect(matchVenue("〇〇Style △△モール TOKYO", venues)?.id).toBe("1");
    expect(matchVenue("××ホール", venues)).toBeNull();
    expect(matchVenue("", venues)).toBeNull();
  });
  it("集合は開始の30分前", () => {
    expect(minutesBefore("11:00", 30)).toBe("10:30");
    expect(minutesBefore("10:15", 30)).toBe("09:45");
  });
});
