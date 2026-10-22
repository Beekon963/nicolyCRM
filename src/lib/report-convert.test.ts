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

  it("PI は MNP、あんせき は あんしんセキュリティ（LINE の報告でよくある略し方）", () => {
    const dict: NameDict = { items: ["新規", "MNP", "SIMのみMNP", "あんしんセキュリティ", "あんしんパック"], aliases: [] };
    expect(resolveItemName("PI", dict)).toMatchObject({ name: "MNP", how: "guess" });
    expect(resolveItemName("simのみPI", dict)).toMatchObject({ name: "SIMのみMNP", how: "guess" });
    expect(resolveItemName("あんせき", dict)).toMatchObject({ name: "あんしんセキュリティ", how: "guess" });
    expect(resolveItemName("あんぱ", dict)).toMatchObject({ name: "あんしんパック", how: "guess" });
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

  it("件数の読めない行は知らせる（項目の名前だけの行・最初の行）", () => {
    expect(parseReportText(["【実績】", "機種変更 2", "Pixel"].join("\n"), NW).unreadable).toEqual(["Pixel"]);
    expect(parseReportText(["【実績】", "Pixel", "機種変更 2"].join("\n")).unreadable).toEqual(["Pixel"]);
  });
});

/** NICOLY フォーマットの取引先（楽天モバイルの催事など）の項目 */
const RM: NameDict = {
  items: ["新規", "RMsimのみMNP", "RMMNP", "カード", "ひかり", "新規（後日）", "RMMNP（後日）"],
  aliases: [],
};

describe("NICOLY フォーマットを読む", () => {
  const text = [
    "【NICOLY フォーマット】",
    "",
    "10/11 〇〇モバイル△△モール",
    "山田",
    "",
    "【実績】",
    "当日",
    "新規1(山田)",
    "",
    "RMsimのみMNP1（山田）",
    "ワイモバイルから楽天",
    "",
    "RMMNP2(山田)",
    "ソフトバンクから楽天",
    "iPhone17×2",
    "",
    "カード1",
    "",
    "ひかり 1",
  ].join("\n");

  it("日付と現場が1行、件数のあとの名前、区切りなしの件数、項目の下のメモを読める", () => {
    const p = parseReportText(text, RM);
    expect(p).toMatchObject({ date: "10/11", venue: "〇〇モバイル△△モール", workers: ["山田"], unreadable: [] });
    expect(p.lines).toEqual([
      { raw: "新規", count: 1, person: "山田" },
      { raw: "RMsimのみMNP", count: 1, person: "山田", notes: ["ワイモバイルから楽天"] },
      { raw: "RMMNP", count: 2, person: "山田", notes: ["ソフトバンクから楽天", "iPhone17×2"] },
      { raw: "カード", count: 1 },
      { raw: "ひかり", count: 1 },
    ]);
    expect(resolveLines(p.lines, RM).map((l) => [l.name, l.how])).toEqual([
      ["新規", "exact"],
      ["RMsimのみMNP", "exact"],
      ["RMMNP", "exact"],
      ["カード", "exact"],
      ["ひかり", "exact"],
    ]);
  });

  it("取引先の項目を渡さなくても、メモは件数に入れない", () => {
    const p = parseReportText(text);
    expect(p.lines.map((l) => [l.raw, l.count])).toEqual([
      ["新規", 1],
      ["RMsimのみMNP", 1],
      ["RMMNP", 2],
      ["カード", 1],
      ["ひかり", 1],
    ]);
  });

  it("「後日」の下の項目は「（後日）」の項目に入れる。（後日）の項目がなければ選んでもらう", () => {
    const p = parseReportText(["【実績】", "当日", "新規1(山田)", "", "後日", "新規2(佐藤)", "RMMNP1(山田)", "カード1"].join("\n"), RM);
    expect(p.lines.map((l) => [l.raw, l.count, l.person])).toEqual([
      ["新規", 1, "山田"],
      ["新規（後日）", 2, "佐藤"],
      ["RMMNP（後日）", 1, "山田"],
      ["カード（後日）", 1, undefined],
    ]);
    expect(resolveLines(p.lines, RM).map((l) => [l.name, l.how, l.candidates])).toEqual([
      ["新規", "exact", []],
      ["新規（後日）", "exact", []],
      ["RMMNP（後日）", "exact", []],
      [null, "unknown", ["カード（後日）"]],
    ]);
  });

  it("「光1（仮）」のように件数のあとの（仮）も読む。見出しより前の「DS〇〇2」は現場名のまま", () => {
    expect(parseItemLine("光1（仮）")).toEqual({ raw: "光（仮）", count: 1 });
    expect(parseItemLine("カード1")).toEqual({ raw: "カード", count: 1 });
    expect(parseItemLine("あんしんセキュリティ999")).toBeNull();
    expect(parseReportText(["10/11", "DS〇〇2", "山田", "【実績】", "新規1"].join("\n"), RM)).toMatchObject({ venue: "DS〇〇2", workers: ["山田"] });
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

describe("見出しと中身が同じ行の所感", () => {
  it("「所感: 〇〇」を所感として読む（項目にはしない）", () => {
    const r = parseReportText("10/21 DSサンプル\n【実績】\n新規 2\n所感: 午後から混みました\n雨でした");
    expect(r.lines.map((l) => `${l.raw}${l.count}`)).toEqual(["新規2"]);
    expect(r.comment).toBe("午後から混みました\n雨でした");
  });
});
