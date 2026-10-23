import { describe, expect, it } from "vitest";
import { looksLikeJobOffer, parseInterviewSlots, parseJobOffer, parseReassignment, parseScreeningResult } from "./parse";

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
