import { describe, expect, it } from "vitest";
import { formatValue } from "./audit-labels";

describe("変更履歴の値の見せ方", () => {
  it("空・はい/いいえ・決まった値は日本語にする（英語やシステムの文字を出さない）", () => {
    expect(formatValue("memo", null)).toBe("なし");
    expect(formatValue("memo", "")).toBe("なし");
    expect(formatValue("is_active", true)).toBe("はい");
    expect(formatValue("cancel_reason_code", "self")).toBe("本人都合（体調不良・私用など）");
    expect(formatValue("response_source", "admin")).toBe("管理者");
    expect(formatValue("status", "confirmed")).toBe("確定");
    expect(formatValue("priority", "mid")).toBe("中");
    expect(formatValue("account_type", "ordinary")).toBe("普通");
    expect(formatValue("base_daily_rate", 16000)).toBe("16,000円");
  });
  it("設定のまとまりは「項目: 値」を並べ、知らない項目は出さない", () => {
    expect(formatValue("value", { include_expenses: false, tax_inclusive: true })).toBe("交通費・経費も源泉の対象: いいえ、税込で源泉を計算: はい");
    expect(formatValue("value", { rate_percent: 10, rounding: "floor" })).toBe("税率（%）: 10、端数: 切り捨て");
    expect(formatValue("value", { unknown_key: 1 })).toBe("（設定）");
  });
});
