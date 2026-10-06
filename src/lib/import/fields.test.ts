import { describe, expect, it } from "vitest";
import { autoMap, mapRow } from "./fields";

// 共有いただいた「メンバー管理」シートの列（中身はダミー）
const HEADERS = ["整理番号", "名前", "キャッチ力", "クローザー力", "立ち回り", "知識", "ランク", "UPD_ID", "電話番号", "メールアドレス", "口座情報", "誓約書送付", "受理"];

describe("列の自動対応づけ", () => {
  it("メンバー管理シートの列を対応づけ、UPD_ID と整理番号は取り込まない（Phase 0 決定8）", () => {
    const m = autoMap("staff", HEADERS);
    expect(m.name).toEqual([1]);
    expect(m.rank).toEqual([6]);
    expect(m.phone).toEqual([8]);
    expect(m.bank_cell).toEqual([10]);
    expect(m.memo).toEqual([2, 3, 4, 5, 9, 11, 12]);
    expect(Object.values(m).flat()).not.toContain(7); // UPD_ID
    expect(Object.values(m).flat()).not.toContain(0); // 整理番号
  });

  it("メモは「列名: 値」でまとめ、空の列は省く", () => {
    const row = ["1", "山田", "〇", "◎", "", "docomo, au", "ss", "999", "090-0000-0000", "dummy@example.com", "ダミー銀行 本店 普通 1234567", "◯", ""];
    const v = mapRow("staff", HEADERS, row, autoMap("staff", HEADERS));
    expect(v.name).toBe("山田");
    expect(v.memo).toBe("キャッチ力: 〇 / クローザー力: ◎ / 知識: docomo, au / メールアドレス: dummy@example.com / 誓約書送付: ◯");
  });

  it("メンバー名簿・スキルシートの列を対応づける（列名の「(11月表)」などは無視）", () => {
    const headers = [
      ...["区分", "氏名", "フリガナ", "性別", "生年月日", "ランク(11月表)", "旧ランク(名簿)", "最寄り駅", "電話", "メール"],
      ...["最終学歴", "催事経験の開始(年月)", "経験キャリア", "経験形態(外販/店内/量販)", "キャッチ力", "クローザー力", "立ち回り"],
      ...["平均獲得件数", "直近実績(月・MNP件数・稼働日数)", "副商材実績", "実績の区分", "人柄・強み", "10月稼働日数"],
      ...["直近入店店舗(10月)", "口座登録", "誓約書送付", "誓約書受理", "現住所", "緊急連絡先", "要確認メモ"],
    ];
    const at = (h: string) => headers.indexOf(h);
    const m = autoMap("staff", headers);
    expect(m.name).toEqual([at("氏名")]);
    expect(m.kana).toEqual([at("フリガナ")]);
    expect(m.rank).toEqual([at("ランク(11月表)")]);
    expect(m.nearest_station).toEqual([at("最寄り駅")]);
    expect(m.phone).toEqual([at("電話")]);
    // 「口座登録」は口座そのものではないのでメモへ
    expect(m.bank_cell).toBeUndefined();
    const memo = m.memo.map((i) => headers[i]);
    expect(memo).toEqual(
      expect.arrayContaining(["旧ランク(名簿)", "経験形態(外販/店内/量販)", "直近実績(月・MNP件数・稼働日数)", "口座登録", "誓約書受理", "要確認メモ"]),
    );
    // 個人的な項目は自動では選ばない
    for (const h of ["区分", "性別", "生年月日", "最終学歴", "現住所", "緊急連絡先", "10月稼働日数"]) expect(memo).not.toContain(h);
  });

  it("取引先・会場の列名", () => {
    expect(autoMap("client", ["会社名", "電話番号", "住所"])).toEqual({ name: [0], phone: [1], address: [2] });
    expect(autoMap("venue", ["店舗名", "最寄駅", "エリア"])).toEqual({ name: [0], nearest_station: [1], area: [2] });
  });
});
