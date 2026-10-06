import { describe, expect, it } from "vitest";
import { companyKey, digitsOnly, matchesQuery, searchNorm } from "./search";

describe("検索の正規化（DB の search_norm と同じ）", () => {
  it("ひらがな・カタカナ・半角カナ・空白を吸収する", () => {
    expect(searchNorm("やまだ　タロウ ﾔﾏﾀﾞ")).toBe("ヤマダタロウヤマダ");
    expect(searchNorm("ＡＢＣ")).toBe("abc");
  });

  it("電話番号はハイフン・全角数字を吸収する", () => {
    expect(digitsOnly("０９０-1234－5678")).toBe("09012345678");
  });

  it("会社名の表記ゆれを吸収する", () => {
    expect(companyKey("㈱ニコリー")).toBe(companyKey("株式会社 ニコリー"));
    expect(companyKey("ニコリー(株)")).toBe(companyKey("ニコリー株式会社"));
    expect(companyKey("有限会社トップ")).toBe("トップ");
  });

  it("名前・かな・電話で探せる", () => {
    const f = { text: ["山田 太郎", "やまだ たろう"], phone: ["090-1234-5678"] };
    expect(matchesQuery("ヤマダ", f)).toBe(true);
    expect(matchesQuery("やまだた", f)).toBe(true);
    expect(matchesQuery("09012345678", f)).toBe(true);
    expect(matchesQuery("1234-5678", f)).toBe(true);
    expect(matchesQuery("佐藤", f)).toBe(false);
    expect(matchesQuery("", f)).toBe(true);
  });
});
