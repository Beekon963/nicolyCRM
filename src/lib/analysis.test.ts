import { describe, expect, it } from "vitest";
import { analyze, rangeOf, type ResultRow } from "./analysis";

const A = { id: "s1", name: "青木" };
const B = { id: "s2", name: "井上" };
const V = { id: "v1", name: "会場1" };
const C = { id: "c1", name: "取引先1" };

const row = (o: Partial<ResultRow> & { items?: ResultRow["items"] }): ResultRow => ({
  eventId: "e1",
  date: "2026-10-05",
  staff: A,
  venue: V,
  client: C,
  submittedAt: "2026-10-05T12:00:00Z",
  confirmedAt: "2026-10-06T01:00:00Z",
  items: [],
  ...o,
});

const it1 = (reported: number | null, confirmed: number | null, item_id = "new") => ({ item_id, reported_count: reported, confirmed_count: confirmed });

describe("実績の集計", () => {
  const rows = [
    row({ items: [it1(3, 2), it1(1, 1, "mnp")] }),
    row({ eventId: "e2", items: [it1(2, 2)] }),
    // 報告はあるが未確定
    row({ eventId: "e3", confirmedAt: null, items: [it1(4, null)] }),
    // 報告なし（件数が分からない稼働）
    row({ eventId: "e4", submittedAt: null, confirmedAt: null }),
    // 管理者が直接確定（速報なし）
    row({ eventId: "e2", staff: B, submittedAt: null, items: [it1(null, 5)] }),
  ];

  it("確定ベース: 確定した稼働だけで数え、1稼働あたりを出す", () => {
    const [b, a] = analyze(rows, "staff", "confirmed");
    expect(b).toMatchObject({ id: "s2", worked: 1, counted: 1, total: 5, avg: 5 });
    expect(a).toMatchObject({ id: "s1", worked: 4, counted: 2, events: 4, total: 5, avg: 2.5, byItem: { new: 4, mnp: 1 } });
  });

  it("速報ベース: 報告のある稼働で数え、速報がなければ確定の件数を使う", () => {
    const [a, b] = analyze(rows, "staff", "reported");
    expect(a).toMatchObject({ id: "s1", counted: 3, total: 10, avg: 3.3 });
    expect(b).toMatchObject({ id: "s2", counted: 1, total: 5 });
  });

  it("会場別・取引先別は現場の数と延べ人数も出す", () => {
    expect(analyze(rows, "venue", "confirmed")[0]).toMatchObject({ id: "v1", events: 4, worked: 5, counted: 3, total: 10, avg: 3.3 });
    expect(analyze(rows, "client", "confirmed")[0]).toMatchObject({ id: "c1", events: 4, worked: 5 });
  });

  it("件数の分かる稼働がなければ平均は出さない", () => {
    expect(analyze([row({ submittedAt: null, confirmedAt: null })], "staff", "confirmed")[0]).toMatchObject({ total: 0, avg: null });
  });
});

describe("期間", () => {
  it("今月は1日から今日まで、先月は月の初めから終わりまで", () => {
    expect(rangeOf("month", "2026-10-10")).toEqual({ start: "2026-10-01", end: "2026-10-10" });
    expect(rangeOf("prev", "2026-10-10")).toEqual({ start: "2026-09-01", end: "2026-09-30" });
  });
  it("年をまたぐ", () => {
    expect(rangeOf("prev", "2027-01-01")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
    expect(rangeOf("3m", "2027-01-15")).toEqual({ start: "2026-11-01", end: "2027-01-15" });
    expect(rangeOf("12m", "2026-10-10")).toEqual({ start: "2025-11-01", end: "2026-10-10" });
  });
});
