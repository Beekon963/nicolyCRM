import { describe, expect, it } from "vitest";
import { expenseKey } from "@/lib/company-expenses";
import { decodeCsv, parseCsv, toCsv } from "@/lib/csv";
import { matchPayer, NOT_EXPENSE_SHEET, parseSheetDate, planExpenseImport, readExpenseSheet } from "./expense-sheet";

/** 今の「経費記録」シートと同じ形（名前・お店・金額はすべて架空） */
const HEAD = ["日付", "購入したもの・サービス", "購入先・支払先", "用途", "区分", "金額（税込・円）", "領収書URL", "メモ", "参加者"];
function sheet(title: string, total: string, count: string, data: string[][]): string[][] {
  return [[], [`${title}｜経費記録`], [], ["合計金額（円）", "記録件数"], [total, count], [], [], [], ["1件につき1行。金額は税込・円で入力。"], HEAD, ...data];
}

describe("経費記録のシートを読む（Phase 16）", () => {
  it("見出しの名前・シートの合計・1件1行を読む（金額の ¥ と 3桁区切り、日付の / も読む）", () => {
    const s = readExpenseSheet(
      sheet("山田", "34,250", "2 件", [
        ["2026/09/03", "プリンター", "家電の店 みなと", "事務所用", "消耗品・備品", "¥32,800", "https://example.com/r/1", "", ""],
        ["2026/09/20", "テスト食堂", "", "", "飲食", "¥1,450", "", "打ち合わせ", "山田、佐藤"],
      ]),
    )!;
    expect(s.owner).toBe("山田");
    expect(s.sheetTotal).toBe(34250);
    expect(s.sheetCount).toBe(2);
    expect(s.warnings).toEqual([]);
    expect(s.rows).toEqual([
      { line: 11, spentOn: "2026-09-03", item: "プリンター", vendor: "家電の店 みなと", purpose: "事務所用", category: "消耗品・備品", amount: 32800, receiptUrl: "https://example.com/r/1", memo: "", attendees: "" },
      { line: 12, spentOn: "2026-09-20", item: "テスト食堂", vendor: "", purpose: "", category: "飲食", amount: 1450, receiptUrl: "", memo: "打ち合わせ", attendees: "山田、佐藤" },
    ]);
  });

  it("空の行は飛ばし、日付・金額・買ったものが足りない行は理由をつけて入れない", () => {
    const s = readExpenseSheet(
      sheet("未振分", "0", "0 件", [
        [],
        ["2026/09/12"],
        ["", "テスト食堂", "", "", "飲食", "¥500"],
        ["2026/09/13", "テスト食堂", "", "", "飲食", "五百円"],
        ["2026/09/14", "", "", "", "飲食", "¥800"],
        ["2026/02/30", "テスト食堂", "", "", "飲食", "¥800"],
        ["2026/09/15", "テスト食堂", "", "", "飲食", "¥0"],
      ]),
    )!;
    expect(s.rows).toEqual([]);
    expect(s.warnings).toEqual([
      "12行目: 金額がないので入れません（2026/09/12）",
      "13行目: 日付が読めないので入れません（テスト食堂）",
      "14行目: 金額「五百円」が読めないので入れません（2026/09/13 テスト食堂）",
      "15行目: 買ったもの・支払先がないので入れません（2026/09/14）",
      "16行目: 日付が読めないので入れません（2026/02/30 テスト食堂）",
      "17行目: 金額「¥0」が読めないので入れません（2026/09/15 テスト食堂）",
    ]);
  });

  it("CSV で保存したもの（全角の ￥・BOM 付き）も同じに読む", () => {
    // Google スプレッドシートの「CSV で保存」と同じく、カンマを含むマスは "" で囲む（toCsv は BOM 付き）
    const csv = toCsv(sheet("佐藤", "2,750", "1 件", [["2026/10/01", "タクシー代", "タクシー", "会場の下見", "交通", "￥2,750", "", "", ""]]));
    const s = readExpenseSheet(parseCsv(decodeCsv(new TextEncoder().encode(csv))))!;
    expect(s.owner).toBe("佐藤");
    expect(s.rows.map((r) => [r.spentOn, r.vendor, r.amount])).toEqual([["2026-10-01", "タクシー", 2750]]);
  });

  it("見出しのないシートでも、列の名前があれば読む（名前は空）", () => {
    const s = readExpenseSheet([["日付", "店", "金額"], ["2026-10-01", "テスト食堂", "1200"]])!;
    expect(s.owner).toBe("");
    expect(s.sheetTotal).toBeNull();
    expect(s.rows[0]).toMatchObject({ spentOn: "2026-10-01", vendor: "テスト食堂", amount: 1200 });
  });

  it("経費記録のシートでなければ null（画面は NOT_EXPENSE_SHEET を出す）", () => {
    expect(readExpenseSheet([["氏名", "かな"], ["山田 太郎", "やまだ たろう"]])).toBeNull();
    expect(NOT_EXPENSE_SHEET).toContain("経費記録");
  });

  it("日付の書き方", () => {
    expect(parseSheetDate("2026/9/6")).toBe("2026-09-06");
    expect(parseSheetDate("2026-09-06")).toBe("2026-09-06");
    expect(parseSheetDate("2026年9月6日(土)")).toBe("2026-09-06");
    expect(parseSheetDate("２０２６／０９／０６")).toBe("2026-09-06");
    expect(parseSheetDate("9/6")).toBeNull();
    expect(parseSheetDate("2026/13/01")).toBeNull();
  });
});

describe("払った人を選ぶ", () => {
  const users = [
    { id: "u1", name: "山田 太郎" },
    { id: "u2", name: "佐藤 花子" },
    { id: "u3", name: "佐藤 次郎" },
  ];
  it("シートの名前が含まれる人が1人ならその人", () => {
    expect(matchPayer("山田", users)).toBe("u1");
    expect(matchPayer("山田太郎", users)).toBe("u1");
  });
  it("「未振分」などは、まだ決めていない（null）", () => {
    expect(matchPayer("未振分", users)).toBeNull();
    expect(matchPayer("未振り分け", users)).toBeNull();
  });
  it("2人以上当たる・だれも当たらないときは、画面で選んでもらう（undefined）", () => {
    expect(matchPayer("佐藤", users)).toBeUndefined();
    expect(matchPayer("鈴木", users)).toBeUndefined();
    expect(matchPayer("", users)).toBeUndefined();
  });
});

describe("取り込む行を決める（同じ経費を2回入れない）", () => {
  const row = (amount: number, vendor = "テスト食堂") => ({ paidBy: "u1", spentOn: "2026-09-20", amount, vendor, item: "" });

  it("CRM にもうある経費は入れない。全角・半角の空白の違いは同じとみなす", () => {
    const plan = planExpenseImport([row(1450, "テスト 食堂"), row(500)], [expenseKey(row(1450, "テスト　食堂 "))]);
    expect(plan.insert).toEqual([row(500)]);
    expect(plan.skipped).toBe(1);
  });

  it("同じ日に同じ店で同じ金額が2行あれば、CRM にある数を引いた分だけ入れる", () => {
    const plan = planExpenseImport([row(1450), row(1450), row(1450)], [expenseKey(row(1450))]);
    expect(plan.insert).toHaveLength(2);
    expect(plan.skipped).toBe(1);
  });

  it("払った人がちがえば別の経費", () => {
    const plan = planExpenseImport([{ ...row(1450), paidBy: null }], [expenseKey(row(1450))]);
    expect(plan.insert).toHaveLength(1);
  });
});
