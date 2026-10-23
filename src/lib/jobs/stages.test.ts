import { describe, expect, it } from "vitest";
import { columnOf, FLOW, isActive, isPassed, KANBAN_COLUMNS, nextStage, progressDots, STAGE_INFO, STAGES, turnOf, urgencyOf } from "./stages";

describe("案件×スタッフの段階", () => {
  it("まっすぐ進む順と次の段階", () => {
    expect(nextStage("candidate")).toBe("staff_ok");
    expect(nextStage("interviewed")).toBe("passed");
    expect(nextStage("briefed")).toBeNull();
    expect(nextStage("failed")).toBeNull();
    expect(FLOW.at(-1)).toBe("briefed");
    for (const s of STAGES) expect(STAGE_INFO[s].label).toBeTruthy();
  });

  it("だれの番か: 面談の日時が過ぎたら自分の番（面談済にする）", () => {
    const now = new Date("2026-10-27T12:00:00Z");
    expect(turnOf("interview_set", "2026-10-28T06:00:00Z", now)).toBe("none");
    expect(turnOf("interview_set", "2026-10-27T06:00:00Z", now)).toBe("us");
    expect(turnOf("sheet_sent", null, now)).toBe("staff");
    expect(turnOf("interviewed", null, now)).toBe("client");
  });

  it("色: 自分の番で24時間以上は赤、相手待ちは黄、合格は緑、不合格は赤", () => {
    const now = new Date("2026-10-27T12:00:00Z");
    expect(urgencyOf("candidate", "2026-10-25T12:00:00Z", null, now)).toBe("alert");
    expect(urgencyOf("candidate", "2026-10-27T10:00:00Z", null, now)).toBe("waiting");
    expect(urgencyOf("slots_sent", "2026-10-20T10:00:00Z", null, now)).toBe("waiting");
    expect(urgencyOf("passed", "2026-10-20T10:00:00Z", null, now)).toBe("done");
    expect(urgencyOf("failed", "2026-10-20T10:00:00Z", null, now)).toBe("alert");
  });

  it("カンバンの列は全部の段階を一度ずつ含む", () => {
    const all = KANBAN_COLUMNS.flatMap((c) => c.stages);
    expect([...all].sort()).toEqual([...STAGES].sort());
    expect(columnOf("interview_set")).toBe("waiting");
    expect(columnOf("briefed")).toBe("passed");
  });

  it("終わった段階・合格の判定と点", () => {
    expect(isActive("candidate")).toBe(true);
    expect(isActive("failed")).toBe(false);
    expect(isPassed("briefed")).toBe(true);
    expect(progressDots("slots_collected")).toEqual({ filled: 4, total: 9 });
    expect(progressDots("failed")).toEqual({ filled: 0, total: 9 });
  });
});
