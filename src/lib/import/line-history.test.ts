import { describe, expect, it } from "vitest";
import { readLineHistory, readReport, splitMessages } from "./line-history";
import { suggestStaff } from "./line-plan";

/** LINE の「トーク履歴を保存」と同じ形（名前・会場は仮のもの） */
const HISTORY = [
  "[LINE] テスト 件数報告のトーク履歴",
  "保存日時：2026/10/12 22:12",
  "",
  "2026/07/24(金)",
  "17:03\t\t管理者が山田をグループに追加しました。",
  '18:18\t山田\t"7月24日',
  "DSテスト東",
  "山田 太郎",
  "",
  "Androidハイエンド機変 2",
  "ドコモMAX 4",
  "ゴールドカード 3",
  "応対数 15",
  "",
  "見込み",
  'ゴールド1"',
  "18:20\t上司\tナイス！",
  "",
  "2026/08/09(日)",
  '18:42\tさとう\t"8/9',
  "テストガーデン南町",
  "　佐藤、鈴木、高橋",
  "",
  "当日",
  "PI1（佐藤、鈴木）",
  "（Ymobile→ahamo）",
  "D払い初回利用",
  "",
  "dカードGOLD1",
  "",
  "見込み・予約",
  "8/10(月)13:00〜",
  "渡辺様",
  'PI1"',
  "",
  "2026/08/10(月)",
  '00:30\tたかし\t"テストモール南',
  'PI0件です。申し訳ございません。"',
  "07:30\tたかし\t起きました",
  "07:31\tたかし\t起きました2",
  "",
  "2026/05/01(金)",
  '17:16\t管理者\t"【店内】',
  "【埼）DSテスト東 店内ヘルパー】",
  "━━━━━━━━━━",
  "【案件詳細】",
  "● 開催場所",
  "DSテスト東（店内）",
  "● 稼働日程",
  "5月毎日稼働",
  "● 稼働メンバー",
  "山田さん：水・木",
  "● 集合場所",
  "9時40分　テスト駅に集合",
  "緊急連絡先：090-0000-0000",
  "【持ち物】",
  '○ ペン"',
].join("\r\n");

describe("トーク履歴をメッセージに分ける", () => {
  it("日付の行・「時刻 名前 本文」・\" で囲んだ複数行を読む。見えない文字は消す", () => {
    const { title, messages } = splitMessages(HISTORY.replace("山田\t", "\u2068山田\u2069\t"));
    expect(title).toBe("テスト 件数報告");
    expect(messages).toHaveLength(8);
    expect(messages[1]).toMatchObject({ date: "2026-07-24", time: "18:18", sender: "山田" });
    expect(messages[1].text.split("\n")[0]).toBe("7月24日");
    expect(messages[1].text.endsWith("ゴールド1")).toBe(true);
    expect(messages[0].sender).toBe("");
  });
});

describe("件数の報告を読む", () => {
  const h = readLineHistory(HISTORY);

  it("「日付 / 会場 / 名前 / 項目 件数」。見込みの下と、応対数（稼働の様子）は数えない", () => {
    const r = h.reports.find((x) => x.date === "2026-07-24")!;
    expect(r).toMatchObject({ venue: "DSテスト東", people: ["山田 太郎"], zero: false });
    expect(r.lines.map((l) => [l.raw, l.count, l.shares])).toEqual([
      ["Androidハイエンド機変", 2, [{ person: "山田 太郎", count: 2 }]],
      ["ドコモMAX", 4, [{ person: "山田 太郎", count: 4 }]],
      ["ゴールドカード", 3, [{ person: "山田 太郎", count: 3 }]],
    ]);
  });

  it("「PI1（A、B）」は0.5件ずつ。名前のない項目は並んだ人数で割る。お客様の名前・予約・乗り換えの行は使わない", () => {
    const r = h.reports.find((x) => x.date === "2026-08-09")!;
    expect(r).toMatchObject({ venue: "テストガーデン南町", people: ["佐藤", "鈴木", "高橋"] });
    expect(r.lines.map((l) => [l.raw, l.sub, l.shares])).toEqual([
      ["PI", false, [{ person: "佐藤", count: 0.5 }, { person: "鈴木", count: 0.5 }]],
      ["D払い初回利用", true, [{ person: "佐藤", count: 0.5 }, { person: "鈴木", count: 0.5 }]],
      ["dカードGOLD", false, [{ person: "佐藤", count: 0.34 }, { person: "鈴木", count: 0.33 }, { person: "高橋", count: 0.33 }]],
    ]);
    expect(JSON.stringify(r)).not.toContain("渡辺");
  });

  it("「PI0件」は獲得なしの報告。0時台に送った日付のない報告は前の日の分。名前がなければ送った人", () => {
    const r = h.reports.find((x) => x.venue === "テストモール南")!;
    expect(r).toMatchObject({ date: "2026-08-09", zero: true, lines: [], people: ["たかし"] });
  });

  it("報告でないメッセージ（あいさつ・「起きました」）は読まない", () => {
    expect(h.reports).toHaveLength(3);
  });

  it("「当日　PI2」「【当日】PI6」のように見出しと同じ行の件数も読む", () => {
    const r = readReport({ date: "2026-08-25", time: "18:00", sender: "x", text: "8/25テストガーデン\n中村、小川\n【実績】\n・当日　PI2\n\nPI1 （中村）" }, 0)!;
    expect(r.lines.map((l) => [l.raw, l.count, l.shares.map((s) => s.person)])).toEqual([
      ["PI", 2, ["中村", "小川"]],
      ["PI", 1, ["中村"]],
    ]);
  });

  it("「合計PI」「全体PI」は上の行と二重になるので数えない", () => {
    const r = readReport({ date: "2026-09-01", time: "18:00", sender: "x", text: "9/1 DSテスト\n山田\nPI 2\nドコモMAX 1\n合計PI 2\n全体PI 5" }, 0)!;
    expect(r.lines.map((l) => l.raw)).toEqual(["PI", "ドコモMAX"]);
  });

  it("件数のあとに会場を書いた報告も読む", () => {
    const r = readReport({ date: "2026-04-26", time: "18:34", sender: "あゆみ", text: "プラチナ1\nドコモマックス2\n\nドコモショップテスト" }, 0)!;
    expect(r).toMatchObject({ venue: "ドコモショップテスト", people: ["あゆみ"] });
    expect(r.lines.map((l) => [l.raw, l.count])).toEqual([
      ["プラチナ", 1],
      ["ドコモマックス", 2],
    ]);
  });
});

describe("スタッフの一覧で名前を見分ける", () => {
  const staff = [
    { id: "s1", name: "山田 太郎", kana: "やまだ たろう" },
    { id: "s2", name: "佐藤 花子", kana: "さとう はなこ" },
    { id: "s3", name: "鈴木 一", kana: "すずき はじめ" },
  ];
  const opts = { person: (n: string) => suggestStaff(n, staff) };
  const read = (text: string) => readReport({ date: "2026-08-20", time: "18:30", sender: "x", text }, 0, opts)!;

  it("「会場 名前 名前」の行を会場と人に分ける。同じ人に当たる「山田 太郎」は1人", () => {
    expect(read("8/20\nテスト東軒先 山田 佐藤\nPI2")).toMatchObject({ venue: "テスト東軒先", people: ["山田", "佐藤"] });
    expect(read("8/20\nDSテスト外販 テスト南（山田、鈴木）\nPI1")).toMatchObject({ venue: "DSテスト外販 テスト南", people: ["山田", "鈴木"] });
    expect(read("8/20\n山田 太郎\nテスト東\nPI1")).toMatchObject({ venue: "テスト東", people: ["山田 太郎"] });
    expect(read("8/20 山田\nDSテスト東\nPI1")).toMatchObject({ venue: "DSテスト東", people: ["山田"] });
    expect(read("8/20\nテスト東\n山田（通称ヤマちゃん）\nPI1")).toMatchObject({ venue: "テスト東", people: ["山田"] });
  });

  it("名前のあとの役目（ダブクロ・戻り）は外す。分からない名前（他社のヘルパー）もその人の分として割る", () => {
    const r = read("8/20\nテスト東\n山田、佐藤\n当日\nPI1（山田、佐藤ダブクロ）\nPI1（山田戻り）\nPI1（他社ヘル）\nPI1（鈴木、他社ヘル）");
    expect(r.lines.map((l) => l.shares)).toEqual([
      [{ person: "山田", count: 0.5 }, { person: "佐藤", count: 0.5 }],
      [{ person: "山田", count: 1 }],
      [{ person: "他社ヘル", count: 1 }],
      [{ person: "鈴木", count: 0.5 }, { person: "他社ヘル", count: 0.5 }],
    ]);
  });
});

describe("数えない行・使わないメッセージ", () => {
  const read = (text: string, time = "18:30") => readReport({ date: "2026-08-20", time, sender: "山田", text }, 0);

  it("「mnp1、電気1（山田）」は2つの項目。機種の名前の数字・乗り換えの説明・大きな数（電話番号）は数えない", () => {
    const r = read("8/20 DSテスト\n当日\nmnp1、電気1（山田）\nソフトバンクからahamo iPhone16\niPhone17\nGalaxy A25\niPhone 2台\n緊急連絡先 0901234\nカード1")!;
    expect(r.lines.filter((l) => !l.sub).map((l) => [l.raw, l.count])).toEqual([
      ["mnp", 1],
      ["電気", 1],
      ["iPhone", 2],
      ["カード", 1],
    ]);
  });

  it("所感・お店全体の実績・累計の下は数えない。日付：・稼働店舗名： の見出しも読む", () => {
    const r = read("日付：8月19日（水）\n稼働店舗名：DSテスト東\n山田\n【当日成約】\nPI1\n(全体実績)\nPI 12\n【所感】\nイベントでした。\n光が1件取れました\n●累計件数\nPI 30")!;
    expect(r).toMatchObject({ date: "2026-08-19", venue: "DSテスト東", people: ["山田"] });
    expect(r.lines.map((l) => [l.raw, l.count])).toEqual([["PI", 1]]);
  });

  it("「● 店舗 / ● 開催場所」の報告は開催場所を会場にする（現場詳細ではない）", () => {
    const h = readLineHistory(["[LINE] t", "2026/05/13(水)", '18:56\t山田\t"5/13（水）', "● 店舗", "ドコモショップテスト", "● 開催場所", "テストモール　催事場", "", "当日", 'PI1（山田）"'].join("\n"));
    expect(h.details).toEqual([]);
    expect(h.reports[0]).toMatchObject({ venue: "テストモール　催事場", people: ["山田"] });
  });

  it("ノートと @ のお知らせは報告として読まない。会場のない報告は、同じ日の同じ人の報告の会場を使う", () => {
    const h = readLineHistory(
      [
        "[LINE] t",
        "2026/08/20(木)",
        "10:00\t上司\t[ノート] DSテスト東 集合 9:45 目標 PI2",
        '12:00\t上司\t"@All 件数は名前を書いてください',
        'PI15（山田、佐藤）"',
        '18:00\t山田\t"8/20 DSテスト東',
        'PI1"',
        "18:05\t山田\tカード1",
        "18:10\t佐藤\tカード2",
      ].join("\n"),
    );
    expect(h.reports.map((r) => [r.sender, r.venue, r.lines.map((l) => l.count)])).toEqual([
      ["山田", "DSテスト東", [1]],
      ["山田", "DSテスト東", [1]],
      ["佐藤", "", [2]],
    ]);
  });
});

describe("現場詳細", () => {
  it("【案件詳細】の投稿を会場ごとに取っておく。古くなる稼働日程・稼働メンバーと電話番号の行は外す", () => {
    const [d] = readLineHistory(HISTORY).details;
    expect(d).toMatchObject({ date: "2026-05-01", venue: "DSテスト東（店内）" });
    expect(d.body).toContain("● 集合場所");
    expect(d.body).toContain("○ ペン");
    expect(d.body).not.toContain("稼働メンバー");
    expect(d.body).not.toContain("山田さん");
    expect(d.body).not.toContain("5月毎日稼働");
    expect(d.body).not.toContain("090");
  });
});
