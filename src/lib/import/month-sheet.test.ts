import { describe, expect, it } from "vitest";
import { guessMonth, parseMonthSheet, parseShift, parseYen } from "./month-sheet";

/** 今の月のシートと同じ形のダミー（名前・会場はすべて架空） */
function sheet(): string[][] {
  const days = Array.from({ length: 30 }, (_, i) => `11/${i + 1}`);
  const blank = () => Array(4 + 30 + 4).fill("");
  const row = (head: string[], cells: Record<number, string> = {}, tail: string[] = []) => {
    const r = blank();
    head.forEach((v, i) => (r[i] = v));
    for (const [d, v] of Object.entries(cells)) r[3 + Number(d)] = v;
    tail.forEach((v, i) => (r[34 + i] = v));
    return r;
  };
  return [
    ["", "", "", "日付", ...days, "出勤日数", "", "売上合計", "人件費合計"],
    ["ランク", "名前", "最寄り駅", "曜日", ...days.map(() => "月")],
    // 上の段
    row(["テスト通信", "", "", "単価"], { 1: "¥22,000", 2: "22,000" }),
    row(["", "", "", "現場"], { 1: "DSテスト中央", 2: "DSテスト中央" }),
    row(["", "", "", "人数"], { 1: "2", 2: "" }),
    row(["", "", "", "単価"], { 3: "21000円＋交通費別" }),
    row(["", "", "", "現場"], { 3: "家電ストア架空" }),
    row(["", "", "", "人数"], { 3: "１" }),
    row(["アオゾラ", "", "", "単価"]),
    row(["", "", "", "現場"], { 5: "テレアポ" }),
    row(["", "", "", "人数"], { 5: "3" }),
    row(["", "", "", "人数"], {}, ["合計"]),
    // 下の段
    row(["S", "山田 太郎", "架空駅", "単価"], { 2: "－3000" }, ["5", "", "¥0"]),
    row(["", "", "", "場所"], { 1: "DSテスト中央", 2: "DSテスト中央", 4: "研修" }),
    row(["", "", "", "シフト"], { 1: "⭕️", 2: "⭕️", 3: "🔺", 4: "❌", 6: "？" }),
    row(["", "鈴木 花子", "", "単価"]),
    row(["", "", "", "場所"], { 3: "家電ストア架空" }),
    row(["", "", "", "シフト"], { 3: "○" }),
    row(["", "", "", "単価"]),
    row(["", "", "", "場所"], { 9: "DSテスト中央" }),
    row(["", "", "", "シフト"]),
  ];
}

describe("単価・シフトの読み取り", () => {
  it.each([
    ["¥22,000", 22000, false],
    ["22,000", 22000, false],
    ["21000円＋交通費別", 21000, true],
    ["－3000", -3000, false],
    ["", null, false],
    ["相談", null, false],
  ])("%s → %s", (raw, amount, transport) => {
    expect(parseYen(raw)).toEqual({ amount, transport });
  });

  it("⭕️○→ok、🔺△→maybe、❌×→ng、それ以外は読まない", () => {
    expect(["⭕️", "○", "◯", "🔺", "△", "❌", "×", "？", ""].map(parseShift)).toEqual(["ok", "ok", "ok", "maybe", "maybe", "ng", "ng", null, null]);
  });
});

describe("月のシートを読む", () => {
  const p = parseMonthSheet(sheet());

  it("日付の行から月と日を読む（合計の列は読まない）", () => {
    expect(p.month).toBe(11);
    expect(p.days).toHaveLength(30);
    expect(p.days[0]).toBe(1);
  });

  it("上の段: 取引先名が空欄の行は直前の取引先の続き。人数の空欄は1人", () => {
    expect(p.clients.map((c) => c.name)).toEqual(["テスト通信", "アオゾラ"]);
    expect(p.clients[0].lines).toEqual([
      { day: 1, venue: "DSテスト中央", required: 2, rate: 22000, transport: false },
      { day: 2, venue: "DSテスト中央", required: 1, rate: 22000, transport: false },
      { day: 3, venue: "家電ストア架空", required: 1, rate: 21000, transport: true },
    ]);
    expect(p.clients[1].lines).toEqual([{ day: 5, venue: "テレアポ", required: 3, rate: null, transport: false }]);
    expect(p.warnings).toContain("テスト通信「DSテスト中央」2日: 人数が空欄・0 なので1人にしました");
  });

  it("下の段: 名前・ランク・最寄り駅、場所、シフト、日ごとの単価を読む", () => {
    expect(p.staff).toHaveLength(2);
    const [a, b] = p.staff;
    expect(a).toMatchObject({ rank: "S", name: "山田 太郎", station: "架空駅" });
    expect(a.places).toEqual([
      { day: 1, place: "DSテスト中央" },
      { day: 2, place: "DSテスト中央" },
      { day: 4, place: "研修" },
    ]);
    expect(a.shifts).toEqual([
      { day: 1, status: "ok" },
      { day: 2, status: "ok" },
      { day: 3, status: "maybe" },
      { day: 4, status: "ng" },
    ]);
    expect(a.rates).toEqual([{ day: 2, amount: -3000, raw: "－3000" }]);
    expect(b).toMatchObject({ name: "鈴木 花子", rank: "", places: [{ day: 3, place: "家電ストア架空" }], shifts: [{ day: 3, status: "ok" }] });
  });

  it("読めないシフトと、名前のない行は注意に出して取り込まない", () => {
    expect(p.warnings).toContain("山田 太郎 6日: シフト「？」は読めないので取り込みません");
    expect(p.warnings.some((w) => w.includes("名前がないスタッフの行"))).toBe(true);
  });

  it("月のシートでないファイルは、日付の行がないと伝える", () => {
    const r = parseMonthSheet([["氏名", "電話"], ["山田", "090"]]);
    expect(r.warnings[0]).toContain("日付の行");
    expect(r.clients).toEqual([]);
  });
});

describe("年の推測（シートには月しかない）", () => {
  it.each([
    [11, "2026-10-10", "2026-11"],
    [5, "2026-10-10", "2026-05"],
    [12, "2026-10-10", "2026-12"],
    [1, "2026-12-20", "2027-01"],
    [11, "2027-02-01", "2026-11"],
    [4, "2026-10-10", "2026-04"],
    [null, "2026-10-10", "2026-10"],
  ])("%s月（今日 %s）→ %s", (m, today, expected) => {
    expect(guessMonth(m, today)).toBe(expected);
  });
});
