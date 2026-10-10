import { describe, expect, it } from "vitest";
import type { ParsedMonthSheet } from "./month-sheet";
import { buildPlan, defaultChoices, NEW, SKIP, type PlanContext } from "./month-sheet-plan";

// 架空の取引先・会場・スタッフ
const parsed: ParsedMonthSheet = {
  month: 11,
  days: Array.from({ length: 30 }, (_, i) => i + 1),
  warnings: [],
  clients: [
    {
      name: "テスト通信",
      lines: [
        { day: 1, venue: "DSテスト中央", required: 2, rate: 22000, transport: false },
        { day: 20, venue: "DSテスト中央", required: 1, rate: null, transport: false },
        { day: 3, venue: "家電ストア架空", required: 1, rate: 21000, transport: true },
      ],
    },
    { name: "新規モバイル", lines: [{ day: 31, venue: "DSテスト中央", required: 1, rate: null, transport: false }] },
  ],
  staff: [
    {
      rank: "S",
      name: "山田　太郎",
      station: "",
      places: [
        { day: 1, place: "DS テスト中央" },
        { day: 4, place: "研修" },
        { day: 20, place: "DSテスト中央" },
      ],
      shifts: [
        { day: 1, status: "ok" },
        { day: 2, status: "ng" },
      ],
      rates: [
        { day: 1, amount: 15000, raw: "15,000" },
        { day: 4, amount: -3000, raw: "－3000" },
      ],
    },
    { rank: "", name: "名簿 にいない", station: "", places: [{ day: 1, place: "DSテスト中央" }], shifts: [], rates: [] },
    { rank: "", name: "鈴木 花子", station: "", places: [{ day: 4, place: "研修" }, { day: 5, place: "DSほかの店" }], shifts: [], rates: [] },
  ],
};

const ctx: PlanContext = {
  today: "2026-11-10",
  clients: [{ id: "c1", name: "株式会社テスト通信" }],
  venues: [
    { id: "v1", name: "DSテスト中央" },
    { id: "v9", name: "DSほかの店" },
  ],
  staff: [
    { id: "s1", name: "山田 太郎" },
    { id: "s2", name: "鈴木 花子" },
  ],
  events: [
    { id: "ex20", date: "2026-11-20", client_id: "c1", venue_id: "v1" },
    { id: "ex5", date: "2026-11-05", client_id: "c9", venue_id: "v9" },
  ],
};

describe("取り込みの計画", () => {
  it("名前が同じ取引先・会場・スタッフを自動で選ぶ（株式会社や空白の違いは無視）", () => {
    const ch = defaultChoices(parsed, ctx, "2026-11");
    expect(ch.clients).toEqual({ テスト通信: "c1", 新規モバイル: NEW });
    expect(ch.venues).toMatchObject({ DSテスト中央: "v1", 家電ストア架空: NEW, 研修: NEW });
    expect(ch.staff).toEqual({ "山田　太郎": "s1", "名簿 にいない": SKIP, "鈴木 花子": "s2" });
    expect(ch.places).toEqual({ 研修: SKIP });
  });

  it("上の段から現場を作り、すでにある現場は使い回す。過去の日は「記録のみ」", () => {
    const plan = buildPlan(parsed, ctx, defaultChoices(parsed, ctx, "2026-11"));
    const byDate = Object.fromEntries(plan.events.map((e) => [`${e.date} ${e.venueName}`, e]));
    expect(byDate["2026-11-01 DSテスト中央"]).toMatchObject({ client: { id: "c1" }, venue: { id: "v1" }, required: 2, rate: 22000, existingId: null, recordOnly: true });
    expect(byDate["2026-11-20 DSテスト中央"]).toMatchObject({ existingId: "ex20", recordOnly: false });
    expect(byDate["2026-11-03 家電ストア架空"]).toMatchObject({ venue: { newName: "家電ストア架空" }, rate: 21000 });
    expect(plan.newVenues).toEqual(["家電ストア架空"]);
    expect(plan.newClients).toEqual([]);
    expect(plan.transportClients).toEqual([{ id: "c1" }]);
    expect(plan.notes).toContain("新規モバイル「DSテスト中央」31日: 11月にない日付なので取り込みません");
  });

  it("下の段: 場所と同じ日の現場に確定で入れる。シートにない場所は CRM の現場を探す", () => {
    const plan = buildPlan(parsed, ctx, defaultChoices(parsed, ctx, "2026-11"));
    const ev = (key: string) => plan.events.find((e) => e.key === key)!;
    const a = plan.assignments.map((x) => ({ staff: x.staffId, at: `${ev(x.eventKey).date} ${ev(x.eventKey).venueName}`, rate: x.dailyRate }));
    expect(a).toEqual([
      { staff: "s1", at: "2026-11-01 DSテスト中央", rate: 15000 },
      { staff: "s1", at: "2026-11-20 DSテスト中央", rate: null },
      { staff: "s2", at: "2026-11-05 DSほかの店", rate: null },
    ]);
    expect(ev(plan.assignments[2].eventKey).existingId).toBe("ex5");
    expect(plan.availability).toEqual([
      { staffId: "s1", date: "2026-11-01", status: "ok" },
      { staffId: "s1", date: "2026-11-02", status: "ng" },
    ]);
  });

  it("名簿にいない人・上の段にない場所・マイナスの単価は取り込まず、理由を出す", () => {
    const plan = buildPlan(parsed, ctx, defaultChoices(parsed, ctx, "2026-11"));
    expect(plan.unknownPlaces).toEqual([{ place: "研修", days: [4] }]);
    expect(plan.notes).toEqual(
      expect.arrayContaining([
        "名簿 にいない: 名簿にいない（または取り込まないにした）ので、予定と稼働可能日は取り込みません",
        "「研修」（4日）は上の段にないので取り込みません",
        "山田　太郎 4日: 単価「－3000」は取り込みません（必要なら Phase 3 で調整額として入れてください）",
      ]),
    );
  });

  it("上の段にない場所に取引先を選ぶと、その日に入っている人数で現場を作る", () => {
    const ch = defaultChoices(parsed, ctx, "2026-11");
    const plan = buildPlan(parsed, ctx, { ...ch, places: { 研修: "c1" } });
    const kenshu = plan.events.find((e) => e.venueName === "研修")!;
    expect(kenshu).toMatchObject({ date: "2026-11-04", client: { id: "c1" }, venue: { newName: "研修" }, required: 2, recordOnly: true });
    expect(plan.assignments.filter((a) => a.eventKey === kenshu.key)).toHaveLength(2);
    expect(plan.newVenues).toContain("研修");
  });

  it("取引先・会場を既存のものに選び直せる（表記ゆれ）", () => {
    const ch = defaultChoices(parsed, ctx, "2026-11");
    const plan = buildPlan(parsed, ctx, { ...ch, venues: { ...ch.venues, 家電ストア架空: "v9" } });
    expect(plan.events.find((e) => e.date === "2026-11-03")).toMatchObject({ venue: { id: "v9" }, venueName: "DSほかの店" });
    expect(plan.newVenues).toEqual([]);
  });
});
