import { describe, expect, it } from "vitest";
import { initialNextAction, isNextActionMissing, needsNextAction, sortCompanies, suggestStatus } from "./sales";

const c = (name: string, o: Partial<Parameters<typeof sortCompanies>[0][number]> = {}) => ({
  name,
  status: "contacted" as const,
  priority: "mid" as const,
  next_action_date: null as string | null,
  next_action: "",
  ...o,
});

describe("次回アクションの必須チェック", () => {
  it("取引中・見送り以外は必須", () => {
    expect(needsNextAction("not_contacted")).toBe(true);
    expect(needsNextAction("met")).toBe(true);
    expect(needsNextAction("active")).toBe(false);
    expect(needsNextAction("dormant")).toBe(false);
  });
  it("日付か「次にやること」のどちらかが空なら未設定", () => {
    expect(isNextActionMissing(c("A", { next_action_date: "2026-10-12", next_action: "電話" }))).toBe(false);
    expect(isNextActionMissing(c("A", { next_action_date: "2026-10-12", next_action: " " }))).toBe(true);
    expect(isNextActionMissing(c("A", { next_action: "電話" }))).toBe(true);
    expect(isNextActionMissing(c("A", { status: "active" }))).toBe(false);
  });
});

describe("一覧の並び", () => {
  it("今日以前 → 未設定 → 先の予定 → 予定なしの取引中の順", () => {
    const list = [
      c("先の予定", { next_action_date: "2026-10-20", next_action: "x" }),
      c("取引中", { status: "active" }),
      c("未設定"),
      c("今日", { next_action_date: "2026-10-10", next_action: "x" }),
      c("期限切れ", { next_action_date: "2026-10-01", next_action: "x" }),
      c("明日", { next_action_date: "2026-10-11", next_action: "x" }),
    ];
    expect(sortCompanies(list, "2026-10-10").map((x) => x.name)).toEqual(["期限切れ", "今日", "未設定", "明日", "先の予定", "取引中"]);
  });
  it("同じ組の中は優先度が高い順、次に名前", () => {
    const list = [c("う", { status: "active" }), c("あ", { status: "active", priority: "low" }), c("い", { status: "active", priority: "high" })];
    expect(sortCompanies(list, "2026-10-10").map((x) => x.name)).toEqual(["い", "う", "あ"]);
  });
});

describe("記録したあとのステータスの候補", () => {
  it("未接触の会社とつながったら接触済み", () => {
    expect(suggestStatus("not_contacted", "call", "reached")).toBe("contacted");
  });
  it("不在・結果なしでは変えない", () => {
    expect(suggestStatus("not_contacted", "call", "absent")).toBe("not_contacted");
    expect(suggestStatus("not_contacted", "call", null)).toBe("not_contacted");
  });
  it("アポ獲得で商談設定、商談の記録で商談済み", () => {
    expect(suggestStatus("contacted", "call", "appointment")).toBe("meeting_set");
    expect(suggestStatus("meeting_set", "meeting", "reached")).toBe("met");
  });
  it("後戻りはしない。取引中・見送りは自動では変えない", () => {
    expect(suggestStatus("met", "call", "reached")).toBe("met");
    expect(suggestStatus("active", "meeting", "appointment")).toBe("active");
    expect(suggestStatus("dormant", "call", "reached")).toBe("dormant");
  });
});

describe("記録の画面を開いたときの次回アクション", () => {
  it("先の予定は残せるように出す", () => {
    expect(initialNextAction({ next_action_date: "2026-10-15", next_action: "商談" }, "2026-10-10")).toEqual({ date: "2026-10-15", text: "商談" });
  });
  it("今日以前の予定は済んだものとして空にする", () => {
    expect(initialNextAction({ next_action_date: "2026-10-10", next_action: "電話" }, "2026-10-10")).toEqual({ date: null, text: "" });
    expect(initialNextAction({ next_action_date: null, next_action: "" }, "2026-10-10")).toEqual({ date: null, text: "" });
  });
});
