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

  it("取引先・会場の列名", () => {
    expect(autoMap("client", ["会社名", "電話番号", "住所"])).toEqual({ name: [0], phone: [1], address: [2] });
    expect(autoMap("venue", ["店舗名", "最寄駅", "エリア"])).toEqual({ name: [0], nearest_station: [1], area: [2] });
  });
});
