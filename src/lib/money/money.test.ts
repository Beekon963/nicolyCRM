import { describe, expect, it } from "vitest";
import {
  applyRate,
  billEvent,
  type BillingEvent,
  divide,
  excludeTax,
  findIncentive,
  findRate,
  grossProfit,
  invoiceTotals,
  itemAmount,
  payAssignment,
  type PayAssignment,
  payStaffMonth,
  type RateTable,
  withholdingAmount,
} from "./index";

const CLOSER = "role-closer";
const CATCHER = "role-catcher";
const NEW_MNP = "item-new-mnp";
const HIKARI = "item-hikari-home5g";

const TAX = { ratePercent: 10, rounding: "floor" as const };
const WH = { includeExpenses: true, taxInclusive: true, taxRatePercent: 10 };

describe("端数処理", () => {
  it("切り捨て・四捨五入・切り上げ", () => {
    expect(divide(105, 10, "floor")).toBe(10);
    expect(divide(105, 10, "round")).toBe(11);
    expect(divide(104, 10, "round")).toBe(10);
    expect(divide(101, 10, "ceil")).toBe(11);
    expect(divide(100, 10, "ceil")).toBe(10);
    expect(applyRate(1001, 10, 100, "floor")).toBe(100);
  });
  it("整数以外は受け付けない（浮動小数で計算しない）", () => {
    expect(() => divide(1.5, 10, "floor")).toThrow();
  });
});

describe("要件 §10 の計算テストケース", () => {
  it("1: 源泉なし。日当15,000円×2日、新規・MNP 3件×3,000円、ドコモ光・home 5G 1件×5,000円、交通費2,400円 → 報酬 44,000円、差引 46,400円", () => {
    const global = new Map([
      [NEW_MNP, 3000],
      [HIKARI, 5000],
    ]);
    const day = (items: BillingEvent["items"]): PayAssignment => ({
      worked: true,
      dailyRate: 15000,
      items,
      incentiveRate: (id) => findIncentive(undefined, global, id),
    });
    const a1 = payAssignment(day([{ itemId: NEW_MNP, confirmed: 2, reported: 2 }]), "confirmed");
    const a2 = payAssignment(day([{ itemId: NEW_MNP, confirmed: 1, reported: 1 }, { itemId: HIKARI, confirmed: 1, reported: 1 }]), "confirmed");
    const p = payStaffMonth({ method: "none", assignments: [a1, a2], expenses: [2400], adjustments: [] }, WH);
    expect(p.reward).toBe(44000);
    expect(p.withholding).toBe(0);
    expect(p.net).toBe(46400);
  });

  it("2: 報酬・料金方式、月の対象額 300,000円 → 源泉 30,630円", () => {
    expect(withholdingAmount("fee", 300_000)).toBe(30_630);
  });

  it("3: 報酬・料金方式、月の対象額 1,200,000円 → 源泉 142,940円（102,100＋40,840）", () => {
    expect(withholdingAmount("fee", 1_200_000)).toBe(142_940);
  });

  it("4: 外交員報酬方式、月の対象額 300,000円 → 源泉 18,378円", () => {
    expect(withholdingAmount("sales_agent", 300_000)).toBe(18_378);
  });

  it("5: 外交員報酬方式、月の対象額 100,000円 → 源泉 0円", () => {
    expect(withholdingAmount("sales_agent", 100_000)).toBe(0);
  });

  const rates: RateTable = {
    event: [],
    clientVenue: [],
    client: [
      { kind: "per_person_day", roleId: CLOSER, itemId: null, amount: 25000 },
      { kind: "per_person_day", roleId: CATCHER, itemId: null, amount: 15000 },
      { kind: "per_item", roleId: null, itemId: NEW_MNP, amount: 5000 },
    ],
  };
  const ev: BillingEvent = {
    id: "e1",
    cancelled: false,
    workers: [{ roleId: CLOSER }, { roleId: CLOSER }, { roleId: CATCHER }],
    items: [{ itemId: NEW_MNP, confirmed: 4, reported: 4 }],
    transport: 0,
  };

  it("6: 人日 クローザー25,000円×2名＋キャッチャー15,000円×1名、成果 新規・MNP 4件×5,000円 → 税抜 85,000円、消費税 8,500円、税込 93,500円", () => {
    const b = billEvent(ev, rates, { billTransport: false, basis: "confirmed" });
    expect(invoiceTotals(b.subtotal, TAX)).toEqual({ subtotal: 85000, tax: 8500, total: 93500 });
  });

  it("7: 6 の現場でクローザー1名が当日不稼働 → 税抜 60,000円。そのスタッフの日当も 0円", () => {
    const b = billEvent({ ...ev, workers: [{ roleId: CLOSER }, { roleId: CATCHER }] }, rates, { billTransport: false, basis: "confirmed" });
    expect(b.subtotal).toBe(60000);
    const noShow = payAssignment({ worked: false, dailyRate: 15000, items: [], incentiveRate: () => 3000 }, "confirmed");
    expect(noShow.daily).toBe(0);
  });

  it("8: 現場で成果単価を 6,000円に上書き → 上書き値で計算される", () => {
    const b = billEvent(ev, { ...rates, event: [{ kind: "per_item", roleId: null, itemId: NEW_MNP, amount: 6000 }] }, { billTransport: false, basis: "confirmed" });
    expect(b.subtotal).toBe(25000 * 2 + 15000 + 6000 * 4);
    expect(b.lines.find((l) => l.kind === "item")).toMatchObject({ unit: 6000, layer: "event" });
  });
});

describe("単価の選び方", () => {
  it("現場の上書き → 取引先×会場 → 取引先 の順", () => {
    const t: RateTable = {
      event: [{ kind: "per_person_day", roleId: CLOSER, itemId: null, amount: 30000 }],
      clientVenue: [
        { kind: "per_person_day", roleId: CLOSER, itemId: null, amount: 27000 },
        { kind: "per_person_day", roleId: CATCHER, itemId: null, amount: 17000 },
      ],
      client: [
        { kind: "per_person_day", roleId: CATCHER, itemId: null, amount: 15000 },
        { kind: "per_event", roleId: null, itemId: null, amount: 10000 },
      ],
    };
    expect(findRate(t, "per_person_day", CLOSER)).toEqual({ amount: 30000, layer: "event" });
    expect(findRate(t, "per_person_day", CATCHER)).toEqual({ amount: 17000, layer: "clientVenue" });
    expect(findRate(t, "per_event")).toEqual({ amount: 10000, layer: "client" });
    expect(findRate(t, "per_item", NEW_MNP)).toBeNull();
  });
  it("インセンティブは現場の上書き → 全体の標準", () => {
    const g = new Map([[NEW_MNP, 3000]]);
    expect(findIncentive(new Map([[NEW_MNP, 4000]]), g, NEW_MNP)).toBe(4000);
    expect(findIncentive(undefined, g, NEW_MNP)).toBe(3000);
    expect(findIncentive(undefined, g, HIKARI)).toBeNull();
  });
});

describe("請求の細かい決まり", () => {
  const rates: RateTable = {
    event: [],
    clientVenue: [],
    client: [
      { kind: "per_person_day", roleId: CLOSER, itemId: null, amount: 25000 },
      { kind: "per_event", roleId: null, itemId: null, amount: 10000 },
      { kind: "per_item", roleId: null, itemId: NEW_MNP, amount: 5000 },
    ],
  };
  const base: BillingEvent = { id: "e", cancelled: false, workers: [{ roleId: CLOSER }], items: [{ itemId: NEW_MNP, confirmed: 2, reported: 3 }], transport: 1200 };

  it("現場固定を足し、交通費は請求する取引先だけ足す", () => {
    expect(billEvent(base, rates, { billTransport: false, basis: "confirmed" }).subtotal).toBe(25000 + 10000 + 10000);
    const b = billEvent(base, rates, { billTransport: true, basis: "confirmed" });
    expect(b.subtotal).toBe(25000 + 10000 + 10000 + 1200);
    expect(b.billedTransport).toBe(1200);
  });
  it("見込みは速報件数で数える（速報がなければ 0）", () => {
    expect(billEvent(base, rates, { billTransport: false, basis: "estimate" }).subtotal).toBe(25000 + 10000 + 15000);
    const noReport = { ...base, items: [{ itemId: NEW_MNP, confirmed: null, reported: null }] };
    expect(billEvent(noReport, rates, { billTransport: false, basis: "estimate" }).subtotal).toBe(35000);
  });
  it("中止の現場は請求しない", () => {
    expect(billEvent({ ...base, cancelled: true }, rates, { billTransport: true, basis: "confirmed" }).subtotal).toBe(0);
  });
  it("人日単価のない役割は 0 円で、足りない単価として知らせる", () => {
    const b = billEvent({ ...base, workers: [{ roleId: CATCHER }] }, rates, { billTransport: false, basis: "confirmed" });
    expect(b.missingRoles).toEqual([CATCHER]);
    expect(b.lines.find((l) => l.kind === "person_day")).toMatchObject({ unit: 0, qty: 1, amount: 0 });
  });
  it("件数が小数（2人で取った0.5件など）でも、0.01件単位で掛けて1円未満は切り捨てる", () => {
    const half = { ...base, items: [{ itemId: NEW_MNP, confirmed: 0.5, reported: 0.5 }] };
    expect(billEvent(half, rates, { billTransport: false, basis: "confirmed" }).lines.find((l) => l.kind === "item")).toMatchObject({ qty: 0.5, amount: 2500 });
    expect(itemAmount(3001, 0.5)).toBe(1500);
    expect(itemAmount(5000, 0.33)).toBe(1650);
    // 0.34 + 0.33 + 0.33 を足した 1 件（足し算の誤差があっても 1 件として掛ける）
    expect(itemAmount(5000, 0.34 + 0.33 + 0.33)).toBe(5000);
    expect(itemAmount(5000, 0)).toBe(0);
  });
  it("消費税の端数処理は設定に従う", () => {
    expect(invoiceTotals(12345, TAX)).toEqual({ subtotal: 12345, tax: 1234, total: 13579 });
    expect(invoiceTotals(12345, { ratePercent: 10, rounding: "round" }).tax).toBe(1235);
    expect(invoiceTotals(12341, { ratePercent: 10, rounding: "ceil" }).tax).toBe(1235);
  });
});

describe("支払いの細かい決まり", () => {
  const a = (dailyRate: number | null): PayAssignment => ({ worked: true, dailyRate, items: [], incentiveRate: () => null });
  it("インセンティブも小数の件数で計算し、1円未満は切り捨てる", () => {
    const p = payAssignment({ worked: true, dailyRate: 10000, items: [{ itemId: NEW_MNP, confirmed: 0.33, reported: 0.33 }], incentiveRate: () => 3001 }, "confirmed");
    expect(p.incentive).toBe(990);
  });
  it("日当が決まっていないときは 0 円で知らせる", () => {
    expect(payAssignment(a(null), "confirmed")).toMatchObject({ daily: 0, missingDailyRate: true });
  });
  it("調整額は報酬に入り、源泉の対象にもなる", () => {
    const p = payStaffMonth({ method: "fee", assignments: [payAssignment(a(100000), "confirmed")], expenses: [], adjustments: [-10000, 5000] }, WH);
    expect(p.reward).toBe(95000);
    expect(p.withholdingBase).toBe(95000);
    expect(p.withholding).toBe(9699);
    expect(p.net).toBe(95000 - 9699);
  });
  it("交通費を源泉の対象に含めない設定・税抜で計算する設定", () => {
    const input = { method: "fee" as const, assignments: [payAssignment(a(110000), "confirmed")], expenses: [5000], adjustments: [] };
    expect(payStaffMonth(input, WH).withholdingBase).toBe(115000);
    expect(payStaffMonth(input, { ...WH, includeExpenses: false }).withholdingBase).toBe(110000);
    expect(payStaffMonth(input, { ...WH, includeExpenses: false, taxInclusive: false }).withholdingBase).toBe(100000);
  });
  it("対象額がマイナスなら源泉は 0", () => {
    const p = payStaffMonth({ method: "fee", assignments: [], expenses: [], adjustments: [-3000] }, WH);
    expect(p.withholding).toBe(0);
    expect(p.net).toBe(-3000);
  });
});

describe("粗利", () => {
  it("請求額（税抜）− 報酬（税抜換算）− 請求しない交通費・経費。請求した交通費は相殺される", () => {
    expect(excludeTax(110000, 10)).toBe(100000);
    // 請求 85,000（うち交通費 2,000）、報酬 44,000（税込）、請求しない経費 1,000
    expect(grossProfit({ invoiceSubtotal: 85000, billedTransport: 2000, reward: 44000, unbilledExpenses: 1000, taxRatePercent: 10 })).toBe(85000 - 2000 - 40000 - 1000);
  });
});

describe("金額の表示と入力", async () => {
  const { formatYen, parseYen, rateRangeText } = await import("./format");
  it("稼働表のマスの単価は、1つならその額、違う単価があれば「安い〜高い」。0円・なしは空", () => {
    expect(rateRangeText([22000, 22000])).toBe("22,000");
    expect(rateRangeText([25000, 20000, 22000])).toBe("20,000〜25,000");
    expect(rateRangeText([0])).toBe("");
    expect(rateRangeText([])).toBe("");
  });
  it("表示は3桁区切りに「円」", () => {
    expect(formatYen(25000)).toBe("25,000円");
    expect(formatYen(-3000)).toBe("−3,000円");
    expect(formatYen(null)).toBe("−");
  });
  it("入力は全角・カンマ・「円」付きでも読む。空は null、数字でなければ NaN", () => {
    expect(parseYen("25,000")).toBe(25000);
    expect(parseYen("２５０００円")).toBe(25000);
    expect(parseYen("")).toBeNull();
    expect(parseYen("abc")).toBeNaN();
    expect(parseYen("1.5")).toBeNaN();
  });
});
