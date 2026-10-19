import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";
import { COMPANY_EXPENSE_HEADER, companyExpenseCsvRows } from "./company-expenses-csv";

const base = { category: "", vendor: "", item: "", purpose: "", attendees: "", memo: "", receiptPath: null, receiptUrl: "" };

describe("会社の経費の CSV（Phase 16）", () => {
  const rows = companyExpenseCsvRows(
    [
      { ...base, spentOn: "2026-10-18", paidBy: "u1", category: "飲食", vendor: "カフェ さくら", item: "打ち合わせのお茶代", attendees: "山田、取引先2名", amount: 1980, receiptPath: "2026-10/a.jpg" },
      { ...base, spentOn: "2026-10-04", paidBy: null, category: "消耗品・備品", vendor: "文具の森", amount: 2640, receiptUrl: "https://example.com/r/2" },
    ],
    (id) => (id === "u1" ? "山田 太郎" : "まだ決めていない"),
  );

  it("今のシートの列に「払った人」を足した見出し", () => {
    expect(rows[0]).toEqual(COMPANY_EXPENSE_HEADER);
  });

  it("日付の古い順に1件1行。領収書は写真の有無か、取り込んだリンク", () => {
    expect(rows[1]).toEqual(["2026/10/04", "まだ決めていない", "消耗品・備品", "文具の森", "", "", "", 2640, "", "https://example.com/r/2"]);
    expect(rows[2]).toEqual(["2026/10/18", "山田 太郎", "飲食", "カフェ さくら", "打ち合わせのお茶代", "", "山田、取引先2名", 1980, "", "写真あり（CRM）"]);
  });

  it("最後に合計の行（件数と合計金額）", () => {
    expect(rows.at(-1)).toEqual(["合計", "", "", "", "", "", "2件", 4620, "", ""]);
  });

  it("Excel で開ける CSV（BOM 付き）になる", () => {
    const csv = toCsv(rows);
    expect(csv.startsWith("﻿日付,払った人,区分")).toBe(true);
    expect(csv).toContain("2026/10/18,山田 太郎,飲食,カフェ さくら,打ち合わせのお茶代,,山田、取引先2名,1980,,写真あり（CRM）");
  });
});
