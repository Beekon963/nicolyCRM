import { describe, expect, it } from "vitest";
import { computeMoney, type MoneyInput } from "./build";
import { buildStatement, statementNotes, statementTotals, withholdingLabels } from "./statement";

/** 支払明細書の前提: 単価は税込、源泉は本体価格（税込 ÷ 1.1 の円未満切捨て）× 10.21%・控除なし */
function input(days: number, rate: number, extra: Partial<MoneyInput> = {}): MoneyInput {
  const events = Array.from({ length: days }, (_, i) => ({
    id: `e${i}`,
    date: `2026-09-${String(i + 1).padStart(2, "0")}`,
    clientId: "c1",
    clientName: "テスト通信",
    venueId: "v1",
    venueName: "DSテスト",
    cancelled: false,
    reportRequired: false,
  }));
  return {
    events,
    assignments: events.map((e, i) => ({ id: `a${i}`, eventId: e.id, staffId: "s1", roleId: "r1", status: "confirmed", reportConfirmed: true })),
    reportItems: [],
    expenses: [],
    clientRates: [],
    eventRates: [],
    incentiveRates: [],
    eventIncentiveRates: [],
    staff: [{ id: "s1", name: "山田 太郎", baseDailyRate: null, rankDailyRate: rate, rankName: "D", method: "fee", invoiceNumber: null }],
    dailyOverrides: [],
    adjustments: [],
    billing: [],
    settings: { taxRatePercent: 10, taxRounding: "floor", withholdingIncludeExpenses: true, withholdingTaxInclusive: false, travelStepAmount: 1000 },
    ...extra,
  };
}
const itemName = (id: string) => ({ mnp: "MNP" })[id] ?? id;

describe("支払明細書", () => {
  it("端数の出る例（14,000円 × 3日 → 合計 42,000 / 本体 38,181 / 消費税 3,819 / 源泉 3,898 / お支払額 38,102）", () => {
    const [s] = computeMoney(input(3, 14000)).staff;
    const st = buildStatement(s, { itemName, taxRatePercent: 10 });
    expect(st.lines).toEqual([{ label: "業務委託報酬（ランクD）", unit: 14000, qty: 3, amount: 42000 }]);
    expect(st).toMatchObject({ worked: 3, total: 42000, base: 38181, tax: 3819, withholdingBase: 38181, withholding: 3898, net: 38102, estimate: false });
    expect(st.mainUnit).toEqual({ unit: 14000, others: false });
  });

  it("日数の多い例（17,000円 × 12日 → 合計 204,000 / 本体 185,454 / 源泉 18,934 / お支払額 185,066）", () => {
    const [s] = computeMoney(input(12, 17000)).staff;
    expect(buildStatement(s, { itemName, taxRatePercent: 10 })).toMatchObject({ total: 204000, base: 185454, withholding: 18934, net: 185066 });
  });

  it("日当の違う日・遠方の上乗せ・インセンティブ・調整額・交通費は行を分け、合計は支払いの計算と同じ", () => {
    const base = input(3, 14000);
    const st = buildStatement(
      computeMoney({
        ...base,
        dailyOverrides: [{ assignmentId: "a2", amount: 15000 }],
        travelSteps: [{ assignmentId: "a0", steps: 2 }],
        reportItems: [
          { assignmentId: "a0", itemId: "mnp", reported: 1, confirmed: 1 },
          { assignmentId: "a1", itemId: "mnp", reported: 0.5, confirmed: 0.5 },
        ],
        incentiveRates: [{ itemId: "mnp", amount: 3000 }],
        adjustments: [{ staffId: "s1", amount: 15000, reason: "友達紹介のボーナス（山田 花子さんが5回稼働）" }],
        expenses: [{ assignmentId: "a1", staffId: "s1", kind: "other", amount: 500, status: "approved" }],
      }).staff[0],
      { itemName, taxRatePercent: 10 },
    );
    expect(st.lines).toEqual([
      { label: "業務委託報酬（ランクD）", unit: 14000, qty: 2, amount: 28000 },
      { label: "業務委託報酬（ランクD）", unit: 15000, qty: 1, amount: 15000 },
      { label: "遠方の上乗せ", unit: 2000, qty: 1, amount: 2000 },
      { label: "インセンティブ（MNP）", unit: 3000, qty: 1.5, amount: 4500 },
      { label: "友達紹介のボーナス（山田 花子さんが5回稼働）", unit: 15000, qty: 1, amount: 15000 },
      { label: "交通費・経費", unit: 500, qty: 1, amount: 500 },
    ]);
    expect(st.total).toBe(65000);
    expect(st.lines.reduce((a, l) => a + l.amount, 0)).toBe(st.total);
    expect(st.mainUnit).toEqual({ unit: 14000, others: true });
    // 本体 59,090、源泉 59,090 × 10.21% = 6,033、お支払額 65,000 − 6,033
    expect(st).toMatchObject({ base: 59090, tax: 5910, withholding: 6033, net: 58967 });
  });

  it("源泉の対象外（なし）の人は源泉 0。実績が未確定なら仮", () => {
    const base = input(2, 13000);
    base.staff[0].method = "none";
    base.events = base.events.map((e) => ({ ...e, reportRequired: true }));
    base.assignments = base.assignments.map((a) => ({ ...a, reportConfirmed: false }));
    const st = buildStatement(computeMoney(base).staff[0], { itemName, taxRatePercent: 10 });
    expect(st).toMatchObject({ total: 26000, withholding: 0, net: 26000, estimate: true });
  });

  it("一覧の合計・見出し・前提条件", () => {
    const a = buildStatement(computeMoney(input(5, 14000)).staff[0], { itemName, taxRatePercent: 10 });
    const b = buildStatement(computeMoney(input(1, 13000)).staff[0], { itemName, taxRatePercent: 10 });
    expect(statementTotals([a, b])).toEqual({ worked: 6, total: 83000, base: a.base + b.base, withholding: a.withholding + b.withholding, net: a.net + b.net });
    expect(withholdingLabels("fee", false)).toEqual({ base: "源泉徴収の対象額（本体価格）", amount: "源泉徴収税額（対象額 × 10.21%）" });
    expect(statementNotes({ method: "fee", taxInclusive: false, includeExpenses: true, taxRatePercent: 10 })).toContain("源泉徴収は本体価格に10.21%を乗じています（円未満切捨て・控除なし）。");
    expect(statementNotes({ method: "fee", taxInclusive: false, includeExpenses: true, taxRatePercent: 10 })[1]).toBe("本体価格は税込金額 × 100 ÷ 110 の円未満切捨て、消費税は差額で算出しています。");
  });
});
