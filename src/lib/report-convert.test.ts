import { describe, expect, it } from "vitest";
import { mergeCounts, normalizeDateLabel, normalizeName, type NameDict, parseItemLine, parseReportText, renameItems, resolveItemName, resolveLines } from "./report-convert";

/** 取引先（NextWave）の公認名称の一部と、「（仮）」の項目 */
const NW: NameDict = {
  items: [
    "新規",
    "機種変更",
    "ドコモ光 1G",
    "ドコモ光 10G",
    "ドコモ光 1G（仮）",
    "ｄカードGOLD U",
    "ｄカードGOLD",
    "ｄカードGOLD（仮）",
    "ｄカードPLATINUM",
    "ドコモ電気",
    "Pixel",
    "Amazonプライム",
    "NetFlix",
    "dバリューパス",
    "ノートン / WB",
    "ノートン / WB 三台版",
    "アドガード",
    "ドコモMAX",
    "ポイ活MAX",
    "セレクト",
    "あんしんセキュリティ999",
    "メンテナンスパック1回",
    "Home 5G",
  ],
  aliases: [{ alias: "アゲサビ", name: "セレクト" }],
};

describe("項目名をそろえる", () => {
  it("全角・半角、大文字・小文字、空白の違いは同じ名前として扱う", () => {
    expect(normalizeName("ｄカード GOLD")).toBe(normalizeName("dカードgold"));
    expect(resolveItemName("pixel", NW)).toMatchObject({ name: "Pixel", how: "exact" });
    expect(resolveItemName("ノートン/WB三台版", NW)).toMatchObject({ name: "ノートン / WB 三台版", how: "exact" });
    expect(resolveItemName("あんしんセキュリティ999", NW)).toMatchObject({ name: "あんしんセキュリティ999", how: "exact" });
  });

  it("言いかえ表にある書き方は、その項目にする", () => {
    expect(resolveItemName("アゲサビ", NW)).toMatchObject({ name: "セレクト", how: "alias" });
  });

  it("略した書き方は推測する（ドコモの商品は「ドコモ〇〇」「ｄカード〇〇」を先に）", () => {
    expect(resolveItemName("キヘン", NW)).toMatchObject({ name: "機種変更", how: "guess" });
    expect(resolveItemName("GOLD", NW)).toMatchObject({ name: "ｄカードGOLD", how: "guess" });
    expect(resolveItemName("プラチナ", NW)).toMatchObject({ name: "ｄカードPLATINUM", how: "guess" });
    expect(resolveItemName("MAX", NW)).toMatchObject({ name: "ドコモMAX", how: "guess" });
    expect(resolveItemName("光", NW)).toMatchObject({ name: "ドコモ光 1G", how: "guess" });
    expect(resolveItemName("光", NW).candidates).toEqual(["ドコモ光 1G", "ドコモ光 10G"]);
    expect(resolveItemName("でんき", NW)).toMatchObject({ name: "ドコモ電気", how: "guess" });
    expect(resolveItemName("アマプラ", NW)).toMatchObject({ name: "Amazonプライム", how: "guess" });
  });

  it("「（仮）」が付いていたら、（仮）の項目に入れる。（仮）の項目がなければわからないにする", () => {
    expect(resolveItemName("光（仮）", NW)).toMatchObject({ name: "ドコモ光 1G（仮）", how: "guess" });
    expect(resolveItemName("GOLD(仮)", NW)).toMatchObject({ name: "ｄカードGOLD（仮）", how: "guess" });
    expect(resolveItemName("ドコモ光 1G（仮）", NW)).toMatchObject({ name: "ドコモ光 1G（仮）", how: "exact" });
    expect(resolveItemName("Pixel（仮）", NW)).toMatchObject({ name: null, how: "unknown", candidates: ["Pixel（仮）"] });
    // 仮でない書き方は、（仮）の項目に推測しない
    expect(resolveItemName("光", NW).candidates).not.toContain("ドコモ光 1G（仮）");
  });

  it("わからない書き方は unknown", () => {
    expect(resolveItemName("ほげほげ", NW)).toMatchObject({ name: null, how: "unknown" });
  });
});

describe("1行を読む", () => {
  it("「項目 件数」「項目×件数」「項目：件数」「項目2件」を読める。名前の中の数字は件数にしない", () => {
    expect(parseItemLine("機種変更 2")).toEqual({ raw: "機種変更", count: 2 });
    expect(parseItemLine("ドコモ光 1G 1")).toEqual({ raw: "ドコモ光 1G", count: 1 });
    expect(parseItemLine("あんしんセキュリティ999 1")).toEqual({ raw: "あんしんセキュリティ999", count: 1 });
    expect(parseItemLine("ノートン / WB 三台版 1")).toEqual({ raw: "ノートン / WB 三台版", count: 1 });
    expect(parseItemLine("MAX×2")).toEqual({ raw: "MAX", count: 2 });
    expect(parseItemLine("光：１")).toEqual({ raw: "光", count: 1 });
    expect(parseItemLine("キヘン2件")).toEqual({ raw: "キヘン", count: 2 });
    expect(parseItemLine("Netflix 1")).toEqual({ raw: "Netflix", count: 1 });
    // 項目名の書き方（全角のかっこなど）は元のまま
    expect(parseItemLine("光（仮）　１")).toEqual({ raw: "光（仮）", count: 1 });
    expect(parseItemLine("ＧＯＬＤ　２")).toEqual({ raw: "ＧＯＬＤ", count: 2 });
    expect(parseItemLine("DSテスト東")).toBeNull();
    expect(parseItemLine("10/11")).toBeNull();
  });

  it("日付は「10/11」の形にする", () => {
    expect(normalizeDateLabel("10月11日")).toBe("10/11");
    expect(normalizeDateLabel("2026/10/09")).toBe("10/9");
    expect(normalizeDateLabel("DSテスト")).toBe("");
  });
});

describe("LINE の報告文を読む", () => {
  it("いただいた見本の形（日付・現場・稼働者・【実績】・【所感】）を読める。公認名称の一覧は読まない", () => {
    const text = [
      "【ネクストウェーブ報告フォーマット】",
      "",
      "日付：10/11",
      "DSテスト東",
      "稼働者：山田 太郎",
      "",
      "【実績】",
      "機種変更 2",
      "Pixel 2",
      "光 1",
      "GOLD 1",
      "アゲサビ 4",
      "",
      "【所感】",
      "店舗様から評価いただきました。",
      "また、明日も予約が入っています。",
      "",
      "【ネクストウェーブ公認名称】",
      "獲得名",
      "新規",
      "機種変更",
    ].join("\n");
    const p = parseReportText(text);
    expect(p.date).toBe("10/11");
    expect(p.venue).toBe("DSテスト東");
    expect(p.workers).toEqual(["山田 太郎"]);
    expect(p.lines).toEqual([
      { raw: "機種変更", count: 2 },
      { raw: "Pixel", count: 2 },
      { raw: "光", count: 1 },
      { raw: "GOLD", count: 1 },
      { raw: "アゲサビ", count: 4 },
    ]);
    expect(p.comment).toBe("店舗様から評価いただきました。\nまた、明日も予約が入っています。");
    expect(p.unreadable).toEqual([]);
  });

  it("見出しのない NICOLY のいつもの書き方（日付・現場・名前・項目）も読める", () => {
    const p = parseReportText(["10/11", "DSテスト東", "山田、佐藤", "キヘン 2", "MAX×3", "プラチナ 1", "", "【コメント】", "雨で来店少なめ"].join("\n"));
    expect(p).toMatchObject({ date: "10/11", venue: "DSテスト東", workers: ["山田", "佐藤"], comment: "雨で来店少なめ" });
    const lines = resolveLines(p.lines, NW);
    expect(lines.map((l) => [l.name, l.count, l.how])).toEqual([
      ["機種変更", 2, "guess"],
      ["ドコモMAX", 3, "guess"],
      ["ｄカードPLATINUM", 1, "guess"],
    ]);
  });

  it("件数の読めない行は知らせる", () => {
    const p = parseReportText(["【実績】", "機種変更 2", "Pixel"].join("\n"));
    expect(p.unreadable).toEqual(["Pixel"]);
  });
});

describe("件数をまとめる・CRM の項目名を直す", () => {
  it("同じ項目は足し、取引先の項目の並び順にそろえる", () => {
    expect(
      mergeCounts(
        [
          { name: "Pixel", count: 1 },
          { name: "機種変更", count: 2 },
          { name: "Pixel", count: 1 },
          { name: "知らない", count: 1 },
        ],
        NW.items,
      ),
    ).toEqual([
      { name: "機種変更", count: 2 },
      { name: "Pixel", count: 2 },
      { name: "知らない", count: 1 },
    ]);
  });

  it("CRM の実績は、言いかえ表にあるものだけ名前を直す（推測では変えない）", () => {
    const dict: NameDict = { items: NW.items, aliases: [{ alias: "ドコモ光", name: "ドコモ光 1G" }, { alias: "光（旧）", name: "ドコモ光 1G" }] };
    expect(
      renameItems(
        [
          { name: "ドコモ光", count: 1 },
          { name: "光（旧）", count: 2 },
          { name: "MAX", count: 3 },
          { name: "新規", count: null },
        ],
        dict,
      ),
    ).toEqual([
      { name: "ドコモ光 1G", count: 3 },
      { name: "MAX", count: 3 },
      { name: "新規", count: null },
    ]);
  });
});
