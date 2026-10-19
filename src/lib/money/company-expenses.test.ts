import { describe, expect, it } from "vitest";
import { summarizeCompanyExpenses } from "./company-expenses";

describe("会社の経費の合計（Phase 16）", () => {
  const rows = [
    { amount: 152800, paidBy: "a", category: "通信・ソフト" },
    { amount: 7700, paidBy: "b", category: "飲食" },
    { amount: 21000, paidBy: "b", category: "飲食" },
    { amount: 1450, paidBy: "b", category: "飲食 " },
    { amount: 18000, paidBy: "b", category: "その他" },
    { amount: 2640, paidBy: null, category: "" },
  ];

  it("合計金額と件数は、今のシートの「合計金額（円）・記録件数」と同じ足し方", () => {
    const s = summarizeCompanyExpenses(rows);
    expect(s.total).toBe(152800 + 7700 + 21000 + 1450 + 18000 + 2640);
    expect(s.count).toBe(6);
  });

  it("払った人ごと・区分ごとに、金額の多い順。まだ決めていない人・区分なしも1つにまとめる", () => {
    const s = summarizeCompanyExpenses(rows);
    expect(s.byPayer).toEqual([
      { key: "a", total: 152800, count: 1 },
      { key: "b", total: 48150, count: 4 },
      { key: null, total: 2640, count: 1 },
    ]);
    // 前後の空白は同じ区分として数える
    expect(s.byCategory).toEqual([
      { key: "通信・ソフト", total: 152800, count: 1 },
      { key: "飲食", total: 30150, count: 3 },
      { key: "その他", total: 18000, count: 1 },
      { key: "", total: 2640, count: 1 },
    ]);
  });

  it("取り消した経費は合計にも件数にも入れない", () => {
    const s = summarizeCompanyExpenses([...rows, { amount: 99999, paidBy: "a", category: "飲食", voided: true }]);
    expect(s.total).toBe(203590);
    expect(s.count).toBe(6);
    expect(s.byPayer[0]).toEqual({ key: "a", total: 152800, count: 1 });
  });

  it("経費がなければ 0円・0件", () => {
    expect(summarizeCompanyExpenses([])).toEqual({ total: 0, count: 0, byPayer: [], byCategory: [] });
  });

  it("同じ金額なら件数の多い順", () => {
    const s = summarizeCompanyExpenses([
      { amount: 1000, paidBy: "a", category: "交通" },
      { amount: 500, paidBy: "b", category: "飲食" },
      { amount: 500, paidBy: "b", category: "飲食" },
    ]);
    expect(s.byPayer.map((g) => g.key)).toEqual(["b", "a"]);
  });
});
