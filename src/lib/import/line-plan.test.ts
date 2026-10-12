import { describe, expect, it } from "vitest";
import type { LineReport } from "./line-history";
import { buildEntries, distinct, suggestStaff, suggestVenue, venueKey } from "./line-plan";

const venues = [
  { id: "v1", name: "DSテスト東" },
  { id: "v2", name: "テストガーデン南町" },
  { id: "v3", name: "ドコモショップテスト西町" },
];
const staff = [
  { id: "s1", name: "山田 太郎", kana: "やまだ たろう" },
  { id: "s2", name: "佐藤 花子", kana: "さとう はなこ" },
  { id: "s3", name: "佐藤 次郎", kana: "さとう じろう" },
  { id: "s4", name: "鈴木 一", kana: "すずき はじめ" },
];

describe("会場を当てる", () => {
  it("「DS」と「ドコモショップ」は同じ。店内・外販・軒先は外して比べる", () => {
    expect(venueKey("ドコモショップテスト東(外販)")).toBe(venueKey("DSテスト東"));
    expect(suggestVenue("ドコモショップテスト東", venues)).toBe("v1");
    expect(suggestVenue("テスト東店内", venues)).toBe("v1");
    expect(suggestVenue("DSテスト西町 軒先", venues)).toBe("v3");
    expect(suggestVenue("テストガーデン南町", venues)).toBe("v2");
    expect(suggestVenue("まったく別の場所", venues)).toBeNull();
    expect(suggestVenue("", venues)).toBeNull();
  });
});

describe("人を当てる", () => {
  it("名前・ふりがなが同じ、または名字・名前だけが1人に合うとき", () => {
    expect(suggestStaff("山田 太郎", staff)).toBe("s1");
    expect(suggestStaff("山田太郎", staff)).toBe("s1");
    expect(suggestStaff("山田", staff)).toBe("s1");
    expect(suggestStaff("やまだ", staff)).toBe("s1");
    expect(suggestStaff("鈴木さん", staff)).toBe("s4");
    expect(suggestStaff("花子", staff)).toBe("s2");
  });
  it("LINE の表示名がスタッフに入っていれば、その人", () => {
    expect(suggestStaff("たろちゃん", [...staff, { id: "s5", name: "田中 太郎", kana: "たなか たろう", line_name: "たろちゃん" }])).toBe("s5");
  });
  it("同じ名字が2人いる・分からない名前は決めない（画面で選ぶ）", () => {
    expect(suggestStaff("佐藤", staff)).toBeNull();
    expect(suggestStaff("たかし", staff)).toBeNull();
    expect(suggestStaff("", staff)).toBeNull();
  });
});

describe("取り込む内容を組み立てる", () => {
  const report = (p: Partial<LineReport>): LineReport => ({ index: 0, date: "2026-08-09", time: "18:42", sender: "さとう", venue: "テストガーデン南町", people: ["佐藤", "鈴木"], lines: [], zero: false, ...p });
  const maps = {
    venue: { テストガーデン南町: "v2", 不明な会場: null } as Record<string, string | null>,
    person: { 佐藤: "s2", 鈴木: "s4", さとう: "s2" } as Record<string, string | null>,
    item: { PI: "mnp", D払い初回利用: null, ゴールド: "gold", GOLD: "gold" } as Record<string, string | null>,
    client: { v2: "c1" },
  };

  it("人ごと・項目ごとに件数をまとめる（同じ項目に当たった書き方は足す）。数えない書き方は入れない", () => {
    const { entries, skipped } = buildEntries(
      [
        report({
          lines: [
            { raw: "PI", count: 1, sub: false, shares: [{ person: "佐藤", count: 0.5 }, { person: "鈴木", count: 0.5 }] },
            { raw: "D払い初回利用", count: 1, sub: true, shares: [{ person: "佐藤", count: 0.5 }, { person: "鈴木", count: 0.5 }] },
            { raw: "ゴールド", count: 1, sub: false, shares: [{ person: "佐藤", count: 1 }] },
            { raw: "GOLD", count: 1, sub: false, shares: [{ person: "佐藤", count: 0.5 }, { person: "鈴木", count: 0.5 }] },
          ],
        }),
      ],
      maps,
    );
    expect(skipped).toEqual([]);
    expect(entries).toEqual([
      {
        date: "2026-08-09",
        venueId: "v2",
        clientId: "c1",
        label: "08/09 テストガーデン南町（さとう 18:42）",
        people: [
          { staffId: "s2", counts: [{ itemId: "mnp", count: 0.5 }, { itemId: "gold", count: 1.5 }] },
          { staffId: "s4", counts: [{ itemId: "mnp", count: 0.5 }, { itemId: "gold", count: 0.5 }] },
        ],
      },
    ]);
  });

  it("獲得なしの報告は件数なしで入れる（稼働した日として平均に入る）", () => {
    const { entries } = buildEntries([report({ zero: true })], maps);
    expect(entries[0].people).toEqual([
      { staffId: "s2", counts: [] },
      { staffId: "s4", counts: [] },
    ]);
  });

  it("会場・人が決まっていない報告と、数える項目がない報告は入れずに理由を返す", () => {
    const { entries, skipped } = buildEntries(
      [
        report({ venue: "不明な会場", lines: [{ raw: "PI", count: 1, sub: false, shares: [{ person: "佐藤", count: 1 }] }] }),
        report({ lines: [{ raw: "D払い初回利用", count: 1, sub: false, shares: [{ person: "佐藤", count: 1 }] }] }),
        report({ people: ["たかし"], lines: [{ raw: "PI", count: 1, sub: false, shares: [{ person: "たかし", count: 1 }] }] }),
      ],
      maps,
    );
    expect(entries).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(["会場を選んでいません", "数える項目がありません", "人を選んでいません"]);
  });

  it("書き方の一覧はよく出てくる順", () => {
    expect(distinct(["PI", "GOLD", "PI", "", "ゴールド", "PI", "GOLD"])).toEqual([
      { value: "PI", count: 3 },
      { value: "GOLD", count: 2 },
      { value: "ゴールド", count: 1 },
    ]);
  });
});
