import { describe, expect, it } from "vitest";
import { datesToText, looksLikeJobOffer, parseDateList, parseInterviewSlots, parseJobOffer, parseReassignment, parseScreeningResult } from "./parse";

const today = "2026-10-23";

// 架空の会場・名前
const OFFER = `11月分お願いします

7日 架空モール軒先　1名
20ミスター架空町田外販　1名
21ミスター架空町田外販　2名
21架空モール軒先　1名
22架空モール軒先1名
27,28 架空エリア外販　2名

単価
22000円/日　交通費込

稼働時間
10:00〜18:00
or
11:00〜19:00

備考
ドコモ強クローザー募集
日当たり2〜3件獲得可能な方
外販経験者`;

describe("案件の文", () => {
  it("日付・会場・人数の行を読み、単価・稼働時間・備考も読む", () => {
    const p = parseJobOffer(OFFER, today);
    expect(p.month).toBe("2026-11");
    expect(p.lines.map((l) => `${l.day} ${l.venue} ${l.count}`)).toEqual([
      "7 架空モール軒先 1",
      "20 ミスター架空町田外販 1",
      "21 ミスター架空町田外販 2",
      "21 架空モール軒先 1",
      "22 架空モール軒先 1",
      "27 架空エリア外販 2",
      "28 架空エリア外販 2",
    ]);
    expect(p.lines[0].date).toBe("2026-11-07");
    // 店舗ごとの日程は月付きで持つ（画面で読み直せる）。同じ店舗でも行ごとに分けて持つ（人数が違うため）
    expect(p.venues.map((v) => `${v.name}|${v.count}|${v.dateText}`)).toEqual([
      "架空モール軒先|1|11/7",
      "ミスター架空町田外販|1|11/20",
      "ミスター架空町田外販|2|11/21",
      "架空モール軒先|1|11/21",
      "架空モール軒先|1|11/22",
      "架空エリア外販|2|11/27・11/28",
    ]);
    expect(parseDateList("3", today, { month: 11 })).toEqual(["2026-11-03"]);
    expect(parseDateList("2・3", today, { month: 11 })).toEqual(["2026-11-02", "2026-11-03"]);
    expect(p.rate).toBe(22000);
    expect(p.transportIncluded).toBe(true);
    expect(p.start).toBe("10:00");
    expect(p.end).toBe("18:00");
    expect(p.hoursNote).toBe("10:00〜18:00 or 11:00〜19:00");
    expect(p.notes).toBe("ドコモ強クローザー募集\n日当たり2〜3件獲得可能な方\n外販経験者");
    expect(looksLikeJobOffer(p, OFFER)).toBe(true);
  });

  it("月が書いてなければ、日が今日以降なら今月、過ぎていれば来月", () => {
    expect(parseJobOffer("25 架空モール 1名\n30 架空モール 1名", today).lines[0].date).toBe("2026-10-25");
    expect(parseJobOffer("3 架空モール 1名\n30 架空モール 1名", today).lines[0].date).toBe("2026-11-03");
    // 単価だけで日程がない文は案件の文ではない
    const p = parseJobOffer("単価 22000円/日", today);
    expect(p.lines).toEqual([]);
    expect(looksLikeJobOffer(p, "単価 22000円/日")).toBe(false);
    // 1行でも単価があれば案件の文
    expect(looksLikeJobOffer(parseJobOffer("25 架空モール 1名\n単価 20000円", today), "25 架空モール 1名\n単価 20000円")).toBe(true);
  });

  it("募集の文（日付が並ぶだけ）や報告の文は案件の文にしない", () => {
    expect(parseJobOffer("〈募集日〉11/1・5・6・10\n稼働時間：11時〜19時", today).lines).toEqual([]);
    expect(parseJobOffer("新規 2件\nMNP 1件", today).lines).toEqual([]);
    // 稼働可能日の文（日と ○△×・休み）は店舗にしない
    const avail = parseJobOffer("11月\n1日 ○\n2日 休み\n3日 ×\n4日 午後から", today);
    expect(avail.venues).toEqual([]);
    expect(looksLikeJobOffer(avail, "11月\n1日 ○\n2日 休み\n3日 ×")).toBe(false);
  });

  // 見出しごとに分かれた書き方（■ 日程 / ■ エントリー期限 / ■ 店舗 ①②… / 単価の行 / ・店名 →N名 ＋【日程】）
  const BLOCKS = `お世話になっております。
年始の案件のご案内です。

■ 日程
1/1〜1/4予定

■ エントリー期限
⚠️11/20まで⚠️

■ 店舗
① 架空カメラ 北店
② 架空カメラ 南店
③ 架空電器×架空カメラ 架空店
④ 架空デンキ 西本店

AM課長に充てるため下記の内容で単価が変わります。
弱　30,000円
一律 24,000円
※新幹線と特急代のみ請求可能

・架空カメラ 北店　→3名
【日程】1/2・1/3・1/4
※追加枠の可能性あり
※家電販売可能な方優先
・架空カメラ 南店　→2名
【日程】1/2・1/3・1/4
※家電販売可能な方優先
・架空電器×架空カメラ 架空店　→25名
【日程】1/1・1/2・1/3
・架空デンキ 西本店
【日程】1/2・1/3・1/4
・家電販売に関しては白物、黒物のみなどは要相談`;

  it("見出しごとの書き方: 全体の日程・期限・店舗（①と →N名 を同じ店舗にまとめる）・店舗ごとの日程・単価の行・※ の備考を分けて読む", () => {
    const p = parseJobOffer(BLOCKS, today);
    expect(p.globalDates).toEqual(["2027-01-01", "2027-01-02", "2027-01-03", "2027-01-04"]);
    expect(p.entryDeadline).toBe("2026-11-20");
    expect(p.venues.map((v) => `${v.name}|${v.count}|${v.dateText}`)).toEqual([
      "架空カメラ 北店|3|1/2・1/3・1/4",
      "架空カメラ 南店|2|1/2・1/3・1/4",
      "架空電器×架空カメラ 架空店|25|1/1・1/2・1/3",
      "架空デンキ 西本店|1|1/2・1/3・1/4",
    ]);
    expect(p.venues[2].dates).toEqual(["2027-01-01", "2027-01-02", "2027-01-03"]);
    expect(p.lines).toHaveLength(12);
    expect(p.lines[0]).toEqual({ date: "2027-01-01", day: 1, venue: "架空電器×架空カメラ 架空店", count: 25 });
    expect(p.month).toBe("2027-01");
    expect(p.markedVenues).toBe(4);
    // 金額の行は単価のまわりの文として別に持つ（備考に入れない）。一律の額を単価にする
    expect(p.rate).toBe(24000);
    expect(p.rateLines).toEqual(["AM課長に充てるため下記の内容で単価が変わります。", "弱 30,000円", "一律 24,000円"]);
    expect(p.transportIncluded).toBe(false);
    expect(p.notes).toBe("※新幹線と特急代のみ請求可能\n※追加枠の可能性あり\n※家電販売可能な方優先\n家電販売に関しては白物、黒物のみなどは要相談");
    expect(p.hoursNote).toBe("");
    expect(looksLikeJobOffer(p, BLOCKS)).toBe(true);
  });

  it("店舗に日程がなければ全体の日程を使う。日程が店舗より先に書いてあれば、その日程を次の店舗に当てる", () => {
    const p = parseJobOffer("■ 日程\n1/1〜1/2\n■ 店舗\n① 架空モール\n② 架空デンキ 北店\n【日程】1/3\n■ 稼働時間\n10時〜19時\n■ 募集人数\n各日2名", today);
    expect(p.venues.map((v) => `${v.name}|${v.count}|${v.dates.join(",")}`)).toEqual(["架空モール|2|", "架空デンキ 北店|2|2027-01-03"]);
    expect(p.lines.map((l) => `${l.date} ${l.venue} ${l.count}`)).toEqual(["2027-01-01 架空モール 2", "2027-01-02 架空モール 2", "2027-01-03 架空デンキ 北店 2"]);
    expect(p.start).toBe("10:00");
    expect(p.end).toBe("19:00");
    expect(p.hoursNote).toBe("10:00〜19:00");

    const f = parseJobOffer("【日程】1/2・1/3\n① 架空モール →3名\n② 架空デンキ 北店\n【日程】1/4\n③ 架空タウン", today);
    expect(f.lines.map((l) => `${l.date} ${l.venue} ${l.count}`)).toEqual(["2027-01-02 架空デンキ 北店 1", "2027-01-02 架空モール 3", "2027-01-03 架空デンキ 北店 1", "2027-01-03 架空モール 3", "2027-01-04 架空タウン 1"]);
  });

  it("同じ行に日程と店舗と人数がある書き方、締切・稼働時間・交通費込の言いかえも読む", () => {
    const p = parseJobOffer("1/2・1/3 架空モール 各日2名\n1/4(日) 架空デンキ 北店 3名\n締切 11/20(木)\n稼働時間：10:00-19:00\n単価 20,000円/日 交通費込", today);
    expect(p.lines.map((l) => `${l.date} ${l.venue} ${l.count}`)).toEqual(["2027-01-02 架空モール 2", "2027-01-03 架空モール 2", "2027-01-04 架空デンキ 北店 3"]);
    expect(p.dayLines).toBe(2);
    expect(p.entryDeadline).toBe("2026-11-20");
    expect(p.hoursNote).toBe("10:00〜19:00");
    expect(p.rate).toBe(20000);
    expect(p.transportIncluded).toBe(true);
    expect(looksLikeJobOffer(p, "")).toBe(true);
    // 店舗の見出しの下の「7日 〇〇」（人数なし）は、人数の見出しがあれば読む
    const n = parseJobOffer("11月\n募集人数: 各日1名\n店舗\n7日 架空モール\n20日 架空デンキ 北店", today);
    expect(n.lines.map((l) => `${l.date} ${l.venue} ${l.count}`)).toEqual(["2026-11-07 架空モール 1", "2026-11-20 架空デンキ 北店 1"]);
  });
});

describe("日付の読み取り", () => {
  it("範囲・月の引きつぎ・年またぎを読み、時刻は日付にしない", () => {
    expect(parseDateList("1/1〜1/4予定", today)).toEqual(["2027-01-01", "2027-01-02", "2027-01-03", "2027-01-04"]);
    expect(parseDateList("11/1・5・6", today)).toEqual(["2026-11-01", "2026-11-05", "2026-11-06"]);
    expect(parseDateList("12/30〜1/2", today)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    expect(parseDateList("10:00〜18:00", today)).toEqual([]);
    expect(parseDateList("11月5日(木) 15時以降", today)).toEqual(["2026-11-05"]);
  });

  it("日付の並びを「1/1〜1/4・1/6」の形に戻せる（読み直すと同じになる）", () => {
    const ds = ["2027-01-01", "2027-01-02", "2027-01-03", "2027-01-04", "2027-01-06", "2027-01-09", "2027-01-10"] as const;
    expect(datesToText([...ds])).toBe("1/1〜1/4・1/6・1/9・1/10");
    expect(parseDateList(datesToText([...ds]), today)).toEqual([...ds]);
    expect(datesToText([])).toBe("");
  });
});

describe("面談候補日の返事", () => {
  it("日付と時間（以降・まで・終日）を読む。月は前の行から引きつぐ", () => {
    const r = parseInterviewSlots("10/26 20:00〜\n10/27 9:00〜12:00\n10月29日(木)終日\n30 15時以降", today);
    expect(r.slots.map((s) => s.text)).toEqual(["10/26 20:00〜", "10/27 9:00〜12:00", "10/29 終日", "10/30 15時以降"]);
    expect(r.slots[0].date).toBe("2026-10-26");
    expect(r.slots[3].date).toBe("2026-10-30");
  });

  it("時間も終日もない行、日付のない行は読まない", () => {
    expect(parseInterviewSlots("よろしくお願いします\n10/26", today).slots).toEqual([]);
    expect(parseInterviewSlots("11/1 ○\n11/2 ×", today).slots).toEqual([]);
  });
});

describe("合否の連絡", () => {
  it("名前と合格・不合格を読む（さん・は・です を除く）", () => {
    expect(parseScreeningResult("検証さん合格です！").results).toEqual([{ name: "検証", passed: true }]);
    expect(parseScreeningResult("試験 花子さんは不合格でした。").results).toEqual([{ name: "試験 花子", passed: false }]);
    expect(parseScreeningResult("検証さんと試験さんは採用、架空さんは見送りとのことです").results).toEqual([
      { name: "検証", passed: true },
      { name: "試験", passed: true },
      { name: "架空", passed: false },
    ]);
    expect(parseScreeningResult("合格: 検証、試験\n不合格: 架空").results).toEqual([
      { name: "検証", passed: true },
      { name: "試験", passed: true },
      { name: "架空", passed: false },
    ]);
  });

  it("前の行の名前に結果が付く。結果のない文は空", () => {
    expect(parseScreeningResult("検証太郎\n合格でした").results).toEqual([{ name: "検証太郎", passed: true }]);
    expect(parseScreeningResult("お世話になっております。明日よろしくお願いします。").results).toEqual([]);
  });
});

describe("人員変更の文", () => {
  it("欠員の人と、新しい割り当て（会場 → 人）を読む", () => {
    const r = parseReassignment("10月30日の架空モール 架空欠員のため人員変更。\n\n試験店 検証と試験\n\n架空モール 花子", today);
    expect(r).not.toBeNull();
    expect(r!.date).toBe("2026-10-30");
    expect(r!.outVenue).toBe("架空モール");
    expect(r!.outNames).toEqual(["架空"]);
    expect(r!.lines).toEqual([
      { venue: "試験店", names: ["検証", "試験"] },
      { venue: "架空モール", names: ["花子"] },
    ]);
  });

  it("人員変更・欠員の言葉がなければ読まない", () => {
    expect(parseReassignment("10/30 架空モール 検証", today)).toBeNull();
  });
});
