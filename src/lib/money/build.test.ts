import { describe, expect, it } from "vitest";
import { computeMoney, type MoneyInput } from "./build";

const CLOSER = "role-closer";
const CATCHER = "role-catcher";
const NEW = "item-new";

function base(): MoneyInput {
  return {
    events: [
      { id: "e1", date: "2026-11-07", clientId: "c1", clientName: "テスト通信", venueId: "v1", venueName: "DSテスト中央", cancelled: false, reportRequired: true },
      { id: "e2", date: "2026-11-08", clientId: "c1", clientName: "テスト通信", venueId: "v2", venueName: "DSテスト北", cancelled: false, reportRequired: true },
    ],
    assignments: [
      { id: "a1", eventId: "e1", staffId: "s1", roleId: CLOSER, status: "confirmed", reportConfirmed: true },
      { id: "a2", eventId: "e1", staffId: "s2", roleId: CLOSER, status: "no_show", reportConfirmed: false },
      { id: "a3", eventId: "e1", staffId: "s3", roleId: CATCHER, status: "confirmed", reportConfirmed: true },
      // e2 は速報だけ（見込み分）
      { id: "a4", eventId: "e2", staffId: "s1", roleId: CLOSER, status: "confirmed", reportConfirmed: false },
    ],
    reportItems: [
      { assignmentId: "a1", itemId: NEW, reported: 3, confirmed: 2 },
      { assignmentId: "a3", itemId: NEW, reported: 1, confirmed: 1 },
      { assignmentId: "a4", itemId: NEW, reported: 2, confirmed: null },
    ],
    expenses: [
      { assignmentId: "a1", staffId: "s1", kind: "transport", amount: 1000, status: "approved" },
      { assignmentId: "a3", staffId: "s3", kind: "other", amount: 500, status: "approved" },
      { assignmentId: "a3", staffId: "s3", kind: "transport", amount: 9999, status: "pending" },
    ],
    clientRates: [
      { companyId: "c1", venueId: null, kind: "per_person_day", roleId: CLOSER, itemId: null, amount: 25000 },
      { companyId: "c1", venueId: null, kind: "per_person_day", roleId: CATCHER, itemId: null, amount: 15000 },
      { companyId: "c1", venueId: null, kind: "per_item", roleId: null, itemId: NEW, amount: 5000 },
      // 会場 v2 だけクローザーが高い
      { companyId: "c1", venueId: "v2", kind: "per_person_day", roleId: CLOSER, itemId: null, amount: 30000 },
    ],
    eventRates: [],
    incentiveRates: [{ itemId: NEW, amount: 3000 }],
    eventIncentiveRates: [],
    staff: [
      { id: "s1", name: "青木", baseDailyRate: 15000, method: "none", invoiceNumber: "T1234567890123" },
      { id: "s2", name: "井上", baseDailyRate: 15000, method: "none", invoiceNumber: null },
      { id: "s3", name: "上田", baseDailyRate: 12000, method: "fee", invoiceNumber: null },
    ],
    dailyOverrides: [{ assignmentId: "a3", amount: 13000 }],
    adjustments: [{ staffId: "s2", amount: 2000, reason: "研修" }],
    billing: [{ companyId: "c1", billTransport: true }],
    settings: { taxRatePercent: 10, taxRounding: "floor", withholdingIncludeExpenses: true, withholdingTaxInclusive: true },
  };
}

describe("月の請求・支払いをまとめる", () => {
  const r = computeMoney(base());

  it("現場ごとの請求: 当日不稼働は数えず、確定件数・請求する交通費を入れる", () => {
    const e1 = r.events.find((e) => e.id === "e1")!;
    expect(e1.status).toBe("confirmed");
    // クローザー1名 25,000 ＋ キャッチャー1名 15,000 ＋ 新規 3件 × 5,000 ＋ 交通費 1,000（承認済みのみ）
    expect(e1.bill.subtotal).toBe(25000 + 15000 + 15000 + 1000);
    expect(e1.bill.billedTransport).toBe(1000);
  });

  it("実績が未確定の現場は見込み分（速報件数・取引先×会場の単価）", () => {
    const e2 = r.events.find((e) => e.id === "e2")!;
    expect(e2.status).toBe("estimate");
    expect(e2.bill.subtotal).toBe(30000 + 2 * 5000);
  });

  it("取引先ごとに1か月分をまとめて消費税をかける", () => {
    const c = r.clients[0];
    expect(c.subtotal).toBe(56000 + 40000);
    expect(c.tax).toBe(9600);
    expect(c.total).toBe(105600);
    expect(c).toMatchObject({ confirmedSubtotal: 56000, estimateSubtotal: 40000 });
  });

  it("スタッフごとの支払い: 日当の上書き・インセンティブ・承認済みの経費・調整額・源泉", () => {
    const s1 = r.staff.find((x) => x.id === "s1")!;
    // e1: 15,000 ＋ 2件×3,000 ／ e2: 15,000 ＋ 速報2件×3,000（見込み）／ 交通費 1,000
    expect(s1.totals).toMatchObject({ daily: 30000, incentive: 12000, expense: 1000, withholding: 0, net: 43000 });
    expect(s1.invoiceRegistered).toBe(true);

    const s3 = r.staff.find((x) => x.id === "s3")!;
    // 日当の上書き 13,000 ＋ 1件×3,000 ＋ 経費 500。報酬・料金: (16,000 ＋ 500) × 10.21% = 1,684
    expect(s3.totals).toMatchObject({ daily: 13000, incentive: 3000, expense: 500, withholdingBase: 16500, withholding: 1684, net: 16000 + 500 - 1684 });

    const s2 = r.staff.find((x) => x.id === "s2")!;
    // 当日不稼働なので日当 0。調整額だけ
    expect(s2.assignments).toHaveLength(0);
    expect(s2.totals).toMatchObject({ daily: 0, adjustment: 2000, net: 2000 });
  });

  it("月の数字: 売上・支払・粗利を確定分と見込み分に分ける", () => {
    // 確定分: 売上 56,000、報酬 (15,000＋6,000)＋(13,000＋3,000)＋調整 2,000 = 39,000、経費 1,500
    expect(r.summary.revenue).toEqual({ confirmed: 56000, estimate: 40000 });
    expect(r.summary.pay).toEqual({ confirmed: 39000 + 1500, estimate: 21000 });
    // 粗利 = 56,000 − 1,000（請求した交通費）− 39,000×100/110 − 500（請求しない経費）
    expect(r.summary.gross.confirmed).toBe(56000 - 1000 - 35454 - 500);
    expect(r.summary.gross.estimate).toBe(40000 - 19090);
  });

  it("日当が決まっていないスタッフ・人日単価のない役割を知らせる", () => {
    const input = base();
    input.staff[0].baseDailyRate = null;
    input.clientRates = input.clientRates.filter((x) => x.roleId !== CATCHER);
    const r2 = computeMoney(input);
    expect(r2.staff.find((x) => x.id === "s1")!.missingDailyRate).toBe(true);
    expect(r2.clients[0].missingRoles).toEqual([CATCHER]);
  });

  it("中止の現場は請求も日当も 0（承認済みの経費は支払う）", () => {
    const input = base();
    input.events[0].cancelled = true;
    const r2 = computeMoney(input);
    expect(r2.events.find((e) => e.id === "e1")!.bill.subtotal).toBe(0);
    expect(r2.staff.find((x) => x.id === "s3")!.totals).toMatchObject({ daily: 0, incentive: 0, expense: 500 });
  });

  it("日当はランクで決まる: 人ごとの日当がなければランクの基準日当。現場ごとの日当・人ごとの日当が先（Phase 12）", () => {
    const input = base();
    input.staff[0] = { ...input.staff[0], baseDailyRate: null, rankDailyRate: 17500 };
    input.staff[2] = { ...input.staff[2], baseDailyRate: 12000, rankDailyRate: 16000 };
    const r2 = computeMoney(input);
    const s1 = r2.staff.find((x) => x.id === "s1")!;
    expect(s1.assignments.map((a) => a.pay.daily)).toEqual([17500, 17500]);
    expect(s1.missingDailyRate).toBe(false);
    // s3 は現場ごとの日当 13,000（人ごとの日当 12,000・ランク 16,000 より先）
    expect(r2.staff.find((x) => x.id === "s3")!.assignments[0].pay.daily).toBe(13000);
    // ランクにも額がなければ「日当が未設定」
    input.staff[0] = { ...input.staff[0], rankDailyRate: null };
    expect(computeMoney(input).staff.find((x) => x.id === "s1")!.missingDailyRate).toBe(true);
  });

  it("遠方の上乗せ: 回数 × 1回分を日当に足す。額が決まっていなければ知らせる（Phase 12）", () => {
    const input = base();
    input.travelSteps = [{ assignmentId: "a1", steps: 2 }];
    input.settings.travelStepAmount = 1000;
    const r2 = computeMoney(input);
    const s1 = r2.staff.find((x) => x.id === "s1")!;
    expect(s1.assignments[0].pay).toMatchObject({ daily: 17000, travel: 2000 });
    expect(s1.totals.daily).toBe(17000 + 15000);
    // 現場の報酬にも入る（請求には入らない）
    const e1 = r2.events.find((e) => e.id === "e1")!;
    expect(e1.reward).toBe(17000 + 6000 + 13000 + 3000);
    expect(e1.bill.subtotal).toBe(25000 + 15000 + 15000 + 1000);
    // 1回分の額がない
    input.settings.travelStepAmount = null;
    const r3 = computeMoney(input);
    expect(r3.staff.find((x) => x.id === "s1")!).toMatchObject({ missingTravelRate: true });
    // 当日不稼働の人には付かない
    input.travelSteps = [{ assignmentId: "a2", steps: 1 }];
    input.settings.travelStepAmount = 1000;
    expect(computeMoney(input).staff.find((x) => x.id === "s2")!.totals.daily).toBe(0);
  });
});
