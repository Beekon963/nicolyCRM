import { describe, expect, it } from "vitest";
import { dbErrorMessage } from "./action-result";

describe("DB のエラーの言いかえ", () => {
  it("よくあるエラーは日本語にする。分からないものは「保存できませんでした」", () => {
    expect(dbErrorMessage({ code: "23505" })).toBe("同じ内容がすでに登録されています。");
    expect(dbErrorMessage({ code: "42501" })).toBe("この操作をする権限がありません。");
    expect(dbErrorMessage({ code: "P0001", message: "締め済みの月です" })).toBe("締め済みの月です");
    expect(dbErrorMessage({ code: "XX000" })).toBe("保存できませんでした。もう一度お試しください。");
    expect(dbErrorMessage(null, "だめでした")).toBe("だめでした");
  });

  it("列・表・関数がない（本番の DB にマイグレーションを流していない）ときは、何をすればいいか出す", () => {
    const expected = "データベースがまだ新しくなっていません。GitHub Actions の「本番のデータベースを更新」を実行してから、もう一度お試しください。";
    expect(dbErrorMessage({ code: "PGRST204", message: "Could not find the 'entry_deadline' column of 'event_groups' in the schema cache" })).toBe(expected);
    expect(dbErrorMessage({ code: "42703" })).toBe(expected);
    expect(dbErrorMessage({ code: "42P01" })).toBe(expected);
    expect(dbErrorMessage({ code: "42883" })).toBe(expected);
  });
});
