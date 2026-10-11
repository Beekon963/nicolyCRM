import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";
import { computeMoney, type MoneyInput } from "@/lib/money";
import { tablesToCsv } from "./backup-csv";
import { buildFreeeRows, DEFAULT_FREEE_SETTINGS, FREEE_COLUMNS, unregisteredPurchaseTax } from "./freee";
import { toZenginKana } from "./kana";
import { invoiceCsvRows, paymentCsvRows } from "./money-csv";
import { buildZengin, encodeZengin, senderProblems, transferProblems, type ZenginSender, type ZenginTransfer } from "./zengin";

describe("全銀のカナ", () => {
  it("ひらがな・全角カナ・小さい文字・濁点を半角カナの大文字にする", () => {
    expect(toZenginKana("やまだ　たろう")).toEqual({ ok: true, value: "ﾔﾏﾀﾞ ﾀﾛｳ" });
    expect(toZenginKana("キャッシュ")).toEqual({ ok: true, value: "ｷﾔﾂｼﾕ" });
    expect(toZenginKana("パーク")).toEqual({ ok: true, value: "ﾊﾟ-ｸ" });
    expect(toZenginKana("ｶﾌﾞｼｷｶﾞｲｼｬ")).toEqual({ ok: true, value: "ｶﾌﾞｼｷｶﾞｲｼﾔ" });
    expect(toZenginKana("ｎｉｃｏｌｙ（カ）")).toEqual({ ok: true, value: "NICOLY(ｶ)" });
    expect(toZenginKana("ヴィ")).toEqual({ ok: true, value: "ｳﾞｲ" });
  });
  it("漢字など使えない文字は知らせる", () => {
    expect(toZenginKana("山田タロウ")).toEqual({ ok: false, bad: ["山", "田"] });
  });
});

const sender: ZenginSender = {
  requesterCode: "1234567890",
  requesterName: "カ）ニコリー",
  bankCode: "0001",
  bankName: "ミズホ",
  branchCode: "001",
  branchName: "トウキヨウ",
  accountType: "ordinary",
  accountNumber: "1234567",
};
const transfer = (over: Partial<ZenginTransfer> = {}): ZenginTransfer => ({
  label: "テスト 太郎",
  bankCode: "0005",
  bankName: "ミツビシユーエフジエイ",
  branchCode: "123",
  branchName: "シンジユク",
  accountType: "ordinary",
  accountNumber: "765432",
  holderKana: "テスト タロウ",
  amount: 89790,
  ...over,
});

describe("全銀フォーマット（総合振込）", () => {
  it("ヘッダー・データ・トレーラー・エンドがすべて120文字で、金額と件数が入る", () => {
    const text = buildZengin(sender, "2026-10-25", [transfer(), transfer({ label: "二人目", amount: 10 })]);
    const lines = text.split("\r\n").filter(Boolean);
    expect(lines.map((l) => l.length)).toEqual([120, 120, 120, 120, 120]);
    expect(lines.map((l) => l[0]).join("")).toBe("12289");
    // ヘッダー: 種別 21（総合振込）・委託者コード・取組日（MMDD）・振込元の銀行と口座
    expect(lines[0].slice(1, 14)).toBe("2101234567890");
    expect(lines[0].slice(54, 58)).toBe("1025");
    expect(lines[0].slice(58, 62)).toBe("0001");
    expect(lines[0].slice(95, 103)).toBe("11234567");
    // データ: 銀行番号・支店番号・口座番号（7桁に0埋め）・名義・金額（10桁）
    const d = lines[1];
    expect(d.slice(1, 5)).toBe("0005");
    expect(d.slice(20, 23)).toBe("123");
    expect(d.slice(42, 43)).toBe("1");
    expect(d.slice(43, 50)).toBe("0765432");
    expect(d.slice(50, 80).trimEnd()).toBe("ﾃｽﾄ ﾀﾛｳ");
    expect(d.slice(80, 90)).toBe("0000089790");
    // トレーラー: 件数2・合計 89,800
    expect(lines[3].slice(1, 19)).toBe("000002000000089800");
    expect(text.endsWith("\r\n")).toBe(true);
  });

  it("Shift_JIS にすると1行120バイト（半角カナは1バイト）", () => {
    const bytes = encodeZengin(buildZengin(sender, "2026-10-25", [transfer()]));
    expect(bytes.length).toBe(4 * 122);
    // 「ﾃ」は Shift_JIS で 0xC3
    expect(bytes[122 + 50]).toBe(0xc3);
  });

  it("口座の情報が足りない人・振込元の設定の不足を知らせる", () => {
    expect(transferProblems(transfer({ bankCode: "", holderKana: "山田" }))).toEqual(["銀行番号", "口座名義に使えない文字（山田）"]);
    expect(transferProblems(transfer({ accountNumber: "12345678" }))).toEqual(["口座番号（7桁まで）"]);
    expect(senderProblems({ ...sender, requesterCode: "123" })).toEqual(["委託者コード（10桁）"]);
    expect(() => buildZengin(sender, "2026-10-25", [transfer({ branchCode: "" })])).toThrow("テスト 太郎");
  });
});

describe("freee の取引のインポート", () => {
  const input = {
    month: "2026-09",
    occurredOn: "2026-09-30",
    dueOn: "2026-10-25",
    invoices: [{ clientName: "テスト通信", subtotal: 100000, tax: 10000, total: 110000 }],
    payments: [
      { staffName: "青木", invoiceRegistered: true, reward: 100000, expense: 1500, withholding: 10363, net: 91137 },
      { staffName: "井上", invoiceRegistered: false, reward: 20000, expense: 0, withholding: 0, net: 20000 },
      { staffName: "上田", invoiceRegistered: false, reward: -500, expense: 0, withholding: 0, net: -500 },
    ],
  };
  const { rows, skipped } = buildFreeeRows(input, DEFAULT_FREEE_SETTINGS);
  const col = (r: (string | number)[], c: (typeof FREEE_COLUMNS)[number]) => r[FREEE_COLUMNS.indexOf(c)];

  it("1行目は見出し。請求は収入（税込・税額つき）", () => {
    expect(rows[0]).toEqual([...FREEE_COLUMNS]);
    const sale = rows[1];
    expect([col(sale, "収支区分"), col(sale, "発生日"), col(sale, "取引先"), col(sale, "勘定科目"), col(sale, "税区分"), col(sale, "金額"), col(sale, "税額")]).toEqual([
      "収入",
      "2026/09/30",
      "テスト通信",
      "売上高",
      "課税売上10%",
      110000,
      10000,
    ]);
  });

  it("支払いは支出の複数行（報酬・交通費経費・源泉はマイナス）。2行目からは収支区分が空で発生日はそろえる", () => {
    const [r1, r2, r3] = rows.slice(2, 5);
    expect([col(r1, "収支区分"), col(r1, "決済期日"), col(r1, "取引先"), col(r1, "勘定科目"), col(r1, "税区分"), col(r1, "金額")]).toEqual([
      "支出",
      "2026/10/25",
      "青木",
      "外注費",
      "課対仕入10%",
      100000,
    ]);
    expect([col(r2, "収支区分"), col(r2, "発生日"), col(r2, "勘定科目"), col(r2, "金額")]).toEqual(["", "2026/09/30", "旅費交通費", 1500]);
    expect([col(r3, "勘定科目"), col(r3, "税区分"), col(r3, "金額")]).toEqual(["預り金", "対象外", -10363]);
    // 報酬 ＋ 交通費 − 源泉 ＝ 差引支払額
    expect((col(r1, "金額") as number) + (col(r2, "金額") as number) + (col(r3, "金額") as number)).toBe(91137);
  });

  it("インボイス登録なしは経過措置の税区分（発生日で変わる）。差引0円以下は取引にしない", () => {
    expect(col(rows[5], "税区分")).toBe("課対仕入（控80）10%");
    expect(unregisteredPurchaseTax("2026-10-31")).toBe("課対仕入（控50）10%");
    expect(rows).toHaveLength(6);
    expect(skipped).toEqual(["上田"]);
  });

  it("税区分・勘定科目は設定で変えられる", () => {
    const r = buildFreeeRows(input, { ...DEFAULT_FREEE_SETTINGS, rewardAccount: "支払報酬料", purchaseTaxUnregistered: "課対仕入10%" });
    expect(col(r.rows[2], "勘定科目")).toBe("支払報酬料");
    expect(col(r.rows[5], "税区分")).toBe("課対仕入10%");
  });
});

describe("請求集計・支払明細の CSV", () => {
  const input: MoneyInput = {
    events: [{ id: "e1", date: "2026-09-07", clientId: "c1", clientName: "テスト通信", venueId: "v1", venueName: "DSテスト中央", cancelled: false, reportRequired: true }],
    assignments: [{ id: "a1", eventId: "e1", staffId: "s1", roleId: "closer", status: "confirmed", reportConfirmed: true }],
    reportItems: [{ assignmentId: "a1", itemId: "new", reported: 2, confirmed: 2 }],
    expenses: [{ assignmentId: "a1", staffId: "s1", kind: "transport", amount: 800, status: "approved" }],
    clientRates: [
      { companyId: "c1", venueId: null, kind: "per_person_day", roleId: "closer", itemId: null, amount: 25000 },
      { companyId: "c1", venueId: null, kind: "per_item", roleId: null, itemId: "new", amount: 5000 },
    ],
    eventRates: [],
    incentiveRates: [{ itemId: "new", amount: 3000 }],
    eventIncentiveRates: [],
    staff: [{ id: "s1", name: "青木", baseDailyRate: 15000, method: "fee", invoiceNumber: null }],
    dailyOverrides: [],
    adjustments: [{ staffId: "s1", amount: -1000, reason: "備品の破損" }],
    billing: [],
    settings: { taxRatePercent: 10, taxRounding: "floor", withholdingIncludeExpenses: true, withholdingTaxInclusive: true },
  };
  const r = computeMoney(input);
  const names = { role: (id: string) => ({ closer: "クローザー" })[id] ?? "", item: (id: string) => ({ new: "新規" })[id] ?? "" };

  it("請求: 現場ごとの明細の下に取引先の合計（税抜・消費税・税込）", () => {
    const rows = invoiceCsvRows("2026-09", r.clients, names);
    expect(rows[1]).toEqual(["テスト通信", "2026-09", "2026-09-07", "DSテスト中央", "人日 クローザー", 25000, 1, 25000, "", "", "確定"]);
    expect(rows[2].slice(4, 8)).toEqual(["成果 新規", 5000, 2, 10000]);
    expect(rows.at(-1)).toEqual(["テスト通信", "2026-09", "", "", "合計", "", "", 35000, 3500, 38500, "確定"]);
  });

  it("支払い: 現場・調整額の行と、スタッフの合計（源泉・差引・状態・支払日）", () => {
    const rows = paymentCsvRows("2026-09", r.staff, { s1: { status: "paid", paidOn: "2026-10-25" } }, names);
    expect(rows[1].slice(5, 10)).toEqual(["稼働 クローザー・新規 2件", 15000, 6000, "", 800]);
    expect(rows[2].slice(5, 9)).toEqual(["調整: 備品の破損", "", "", -1000]);
    const total = rows.at(-1)!;
    const t = r.staff[0].totals;
    expect(total.slice(5, 16)).toEqual(["合計", 15000, 6000, -1000, 800, t.withholding, t.net, "なし", "報酬・料金", "支払済", "2026-10-25"]);
    expect(t.net).toBe(15000 + 6000 - 1000 + 800 - t.withholding);
  });

  it("Excel で文字化けしない（UTF-8 BOM 付き）", () => {
    expect(toCsv(invoiceCsvRows("2026-09", r.clients, names)).startsWith("﻿取引先,請求月")).toBe(true);
  });
});

describe("全データの書き出し", () => {
  it("マイページの鍵は列からも変更履歴の中身からも消す", () => {
    const csv = tablesToCsv([
      { id: "1", name: "テスト", mypage_token: "secret-abc", token_rotated_at: "2026-10-01", memo: null },
      { id: "2", name: "履歴", mypage_token: "secret-def", token_rotated_at: null, memo: { after: { mypage_token: "secret-ghi", name: "x" } } },
    ]);
    expect(csv).not.toContain("secret");
    expect(csv).not.toContain("token");
    expect(csv.split("\r\n")[0]).toBe("\uFEFFid,name,memo");
    expect(csv).toContain('"{""after"":{""name"":""x""}}"');
  });
});
