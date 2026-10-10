import { describe, expect, it } from "vitest";
import { memoForEdit, memoValueTone, parseStaffMemo } from "./staff-memo";

describe("スタッフのメモを見やすく分ける", () => {
  it("取り込みでまとめた「列名: 値 / 列名: 値」を、まとまりごとの項目にする", () => {
    const r = parseStaffMemo("キャッチ力: 4 / クローザー力: 3 / 知識: docomo / au / 誓約書送付: 済 / メールアドレス: test@example.com / 平均獲得件数: 2.5 / 好きな現場: 量販店");
    expect(r.notes).toEqual([]);
    expect(r.groups).toEqual([
      {
        title: "スキル・経験",
        items: [
          { label: "キャッチ力", value: "4" },
          { label: "クローザー力", value: "3" },
          { label: "知識", value: "docomo / au" },
        ],
      },
      { title: "実績", items: [{ label: "平均獲得件数", value: "2.5" }] },
      { title: "手続き", items: [{ label: "誓約書送付", value: "済" }] },
      { title: "連絡先", items: [{ label: "メールアドレス", value: "test@example.com" }] },
      { title: "そのほか", items: [{ label: "好きな現場", value: "量販店" }] },
    ]);
  });

  it("備考・メモの列と、列名のない文章は、文章のまま出す", () => {
    const r = parseStaffMemo("備考: 土日のみ / キャッチ力: 5\n18:00以降なら連絡可\nhttps://example.com/a");
    expect(r.notes).toEqual(["土日のみ", "18:00以降なら連絡可", "https://example.com/a"]);
    expect(r.groups).toEqual([{ title: "スキル・経験", items: [{ label: "キャッチ力", value: "5" }] }]);
  });

  it("1項目1行の形でも同じように分ける。値が空の項目は出さない", () => {
    const r = parseStaffMemo("キャッチ力：4\n受理: \n立ち回り: 良い");
    expect(r.groups).toEqual([
      {
        title: "スキル・経験",
        items: [
          { label: "キャッチ力", value: "4" },
          { label: "立ち回り", value: "良い" },
        ],
      },
    ]);
  });

  it("空のメモ", () => {
    expect(parseStaffMemo("")).toEqual({ notes: [], groups: [] });
    expect(parseStaffMemo(null)).toEqual({ notes: [], groups: [] });
  });
});

describe("値の色分け", () => {
  it("○・済は緑、未は黄（待ち）、×・なしは灰色、それ以外は色を付けない", () => {
    expect(memoValueTone("○")).toBe("good");
    expect(memoValueTone("済")).toBe("good");
    expect(memoValueTone("未")).toBe("waiting");
    expect(memoValueTone("×")).toBe("muted");
    expect(memoValueTone("なし")).toBe("muted");
    expect(memoValueTone("4")).toBeNull();
  });
});

describe("編集画面のメモ", () => {
  it("項目の区切りだけを改行にし、値の中の「 / 」はそのまま残す", () => {
    expect(memoForEdit("キャッチ力: 4 / 知識: docomo / au / 誓約書送付: 済")).toBe("キャッチ力: 4\n知識: docomo / au\n誓約書送付: 済");
    expect(memoForEdit("土日のみ / 夜は不可")).toBe("土日のみ / 夜は不可");
    expect(memoForEdit("")).toBe("");
  });
});
