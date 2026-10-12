import { describe, expect, it } from "vitest";
import { REPORT_PRESETS, renderReport, type ReportDay } from "./report-format";

const day: ReportDay = {
  date: "10/10",
  weekday: "土",
  clientName: "テスト通信",
  events: [
    {
      venueName: "DSテスト中央",
      time: "10:00〜19:00",
      people: [
        { name: "青木", role: "クローザー", items: [{ name: "新規", count: 3 }, { name: "MNP", count: 1 }], comment: "好調" },
        { name: "井上", role: "キャッチャー", items: [{ name: "新規", count: 1 }, { name: "MNP", count: null }], comment: "" },
      ],
    },
    {
      venueName: "DSテスト北",
      time: "11:00〜18:00",
      people: [{ name: "上田", role: "クローザー", items: [{ name: "新規", count: null }, { name: "MNP", count: null }], comment: "", unreported: true }],
    },
  ],
};

describe("日報のフォーマット", () => {
  it("はじめ → 現場ごと → 1人ごと → おわり の順に、差し込みを置き換える", () => {
    const text = renderReport(
      {
        header: "【日報】{日付}（{曜日}）{取引先}\n合計 {件数一覧}",
        eventBlock: "■{会場} {時間}（{人数}名）",
        personBlock: "{名前}（{役割}）新規{件数:新規} MNP{件数:MNP}\n{コメント}",
        footer: "以上 {現場数}現場 {人数}名 計{件数合計}件",
      },
      day,
    );
    expect(text).toBe(
      [
        "【日報】10/10（土）テスト通信",
        "合計 新規 4 / MNP 1",
        "■DSテスト中央 10:00〜19:00（2名）",
        "青木（クローザー）新規3 MNP1",
        "好調",
        "井上（キャッチャー）新規1 MNP0",
        "",
        "■DSテスト北 11:00〜18:00（1名）",
        "上田（クローザー）新規0 MNP0",
        "",
        "以上 2現場 3名 計5件",
      ].join("\n"),
    );
  });

  it("件数一覧は「項目 件数」を / でつなぐ。未報告の人は（未報告）と出す", () => {
    const text = renderReport({ header: "", eventBlock: "", personBlock: "{名前}: {件数一覧}（計{件数合計}）", footer: "" }, day);
    expect(text.split("\n")).toEqual(["青木: 新規 3 / MNP 1（計4）", "井上: 新規 1 / MNP 0（計1）", "上田: （未報告）（計（未報告））"]);
  });

  it("知らない差し込みはそのまま残し、空のブロックは出さない。行末の空白と続く空行を詰める", () => {
    const text = renderReport({ header: "{日付} {天気}   ", eventBlock: "", personBlock: "", footer: "\n\n\n終わり" }, day);
    expect(text).toBe("10/10 {天気}\n\n終わり");
  });

  it("マイページ（本人の1人分）でも同じ書式で作れる", () => {
    const mine: ReportDay = { ...day, events: [{ ...day.events[0], people: [day.events[0].people[0]] }] };
    const text = renderReport({ header: "{日付} {取引先}", eventBlock: "{会場}", personBlock: "{名前} {件数一覧}", footer: "" }, mine);
    expect(text).toBe("10/10 テスト通信\nDSテスト中央\n青木 新規 3 / MNP 1");
  });

  it("獲得した項目は0件を出さずに1行ずつ。1つもなければ「なし」", () => {
    const text = renderReport({ header: "", eventBlock: "{会場}\n{獲得した項目}", personBlock: "", footer: "" }, day);
    expect(text).toBe("DSテスト中央\n新規 4\nMNP 1\nDSテスト北\nなし");
  });

  it("稼働者は全員の名前、所感は2人以上なら名前つき", () => {
    const text = renderReport({ header: "", eventBlock: "{稼働者}\n{所感}", personBlock: "", footer: "" }, day);
    expect(text).toBe("青木、井上\n青木：好調\n上田");
  });
});

describe("書式の見本: NextWave", () => {
  const nextwave = REPORT_PRESETS.find((p) => p.key === "nextwave")!.blocks;
  const one: ReportDay = {
    date: "10/11",
    weekday: "日",
    clientName: "ネクストウェーブ",
    events: [
      {
        venueName: "DSテスト東",
        time: "10:00〜19:00",
        people: [
          {
            name: "山田 太郎",
            role: "クローザー",
            items: [
              { name: "新規", count: 0 },
              { name: "機種変更", count: 2 },
              { name: "Pixel", count: 2 },
              { name: "ドコモ光 1G", count: 1 },
            ],
            comment: "店舗様から評価いただきました。",
          },
        ],
      },
    ],
  };

  it("いただいた見本と同じ形（獲得した項目だけ1行ずつ、所感）", () => {
    expect(renderReport(nextwave, one)).toBe(
      [
        "【ネクストウェーブ報告フォーマット】",
        "",
        "日付：10/11",
        "DSテスト東",
        "稼働者：山田 太郎",
        "",
        "【実績】",
        "機種変更 2",
        "Pixel 2",
        "ドコモ光 1G 1",
        "",
        "【所感】",
        "店舗様から評価いただきました。",
      ].join("\n"),
    );
  });

  it("2人以上の現場は全員分を1つにまとめ、現場が2つなら1行あけて続ける", () => {
    const two: ReportDay = {
      ...one,
      events: [
        { ...one.events[0], people: [one.events[0].people[0], { name: "佐藤 花子", role: "キャッチャー", items: [{ name: "機種変更", count: 1 }], comment: "" }] },
        { venueName: "DSテスト西", time: "", people: [{ name: "鈴木 一郎", role: "クローザー", items: [{ name: "新規", count: 0 }], comment: "" }] },
      ],
    };
    const lines = renderReport(nextwave, two).split("\n");
    expect(lines).toContain("稼働者：山田 太郎、佐藤 花子");
    expect(lines).toContain("機種変更 3");
    expect(lines).toContain("山田 太郎：店舗様から評価いただきました。");
    // 2つ目の現場の前は1行あく
    const second = lines.indexOf("DSテスト西");
    expect(lines.slice(second - 4, second)).toEqual(["", "【ネクストウェーブ報告フォーマット】", "", "日付：10/11"]);
    expect(lines.at(-3)).toBe("なし");
  });
});
