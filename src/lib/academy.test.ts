import { describe, expect, it } from "vitest";
import { areaComplete, areasOf, decisionOf, toAcademyProgress } from "./academy";

describe("アカデミーの記録（DB の行 → 画面）", () => {
  it("稼働判断は3つのどれか。知らない値は未判定", () => {
    expect(decisionOf("ready")).toBe("ready");
    expect(decisionOf("hold")).toBe("hold");
    expect(decisionOf("none")).toBe("none");
    expect(decisionOf("maybe")).toBe("none");
    expect(decisionOf(null)).toBe("none");
  });

  it("分野は形の合うものだけ読む", () => {
    expect(areasOf([{ name: "携帯", done: 8, total: 8, test: true }, { name: "光", done: 1, total: 7 }, { name: 3 }, null, "x"])).toEqual([
      { name: "携帯", done: 8, total: 8, test: true },
      { name: "光", done: 1, total: 7, test: false },
    ]);
    expect(areasOf({})).toEqual([]);
  });

  it("分野が終わった = 章を全部 ＋ テスト合格", () => {
    expect(areaComplete({ name: "携帯", done: 8, total: 8, test: true })).toBe(true);
    expect(areaComplete({ name: "携帯", done: 8, total: 8, test: false })).toBe(false);
    expect(areaComplete({ name: "携帯", done: 7, total: 8, test: true })).toBe(false);
    expect(areaComplete({ name: "空", done: 0, total: 0, test: true })).toBe(false);
  });

  it("行をそのまま画面の形にする（数のない列は null）", () => {
    const p = toAcademyProgress({
      staff_id: "s1",
      academy_id: "learner01",
      academy_name: "山田 太郎",
      active: true,
      roadmap_done: 14,
      roadmap_steps: 40,
      title: "携帯を案内できる",
      areas: [{ name: "携帯", done: 8, total: 8, test: true }],
      knowledge: "合格",
      knowledge_ok: true,
      roleplay: "まだ",
      roleplay_ok: false,
      field_done: null,
      field_items: null,
      decision: "hold",
      hearing_count: 1,
      guide: "読了",
      last_studied_at: "2026-10-12T14:30:00+00:00",
      imported_at: "2026-10-13T00:00:00+00:00",
      imported_by: null,
    });
    expect(p).toMatchObject({ staffId: "s1", academyId: "learner01", roadmap: { done: 14, total: 40 }, field: null, decision: "hold", hearing: 1, knowledgeOk: true, roleplayOk: false });
    expect(p.areas).toHaveLength(1);
  });
});
