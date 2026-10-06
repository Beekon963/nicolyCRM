import { describe, expect, it } from "vitest";
import { decodeCsv, parseCsv, toCsv } from "./csv";
import { parseBankCell } from "./import/bank";

describe("CSV", () => {
  it("カンマ・改行・ダブルクォートを含む値を読める", () => {
    expect(parseCsv('名前,メモ\r\n山田,"A,B"\r\n"佐藤","1行目\n2行目 ""引用"""\r\n')).toEqual([
      ["名前", "メモ"],
      ["山田", "A,B"],
      ["佐藤", '1行目\n2行目 "引用"'],
    ]);
  });

  it("空の行は捨てる", () => {
    expect(parseCsv("a,b\n\n,\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("UTF-8（BOM あり）と Shift_JIS の両方を読める", () => {
    const utf8 = new TextEncoder().encode("﻿名前\n山田");
    expect(decodeCsv(utf8)).toBe("名前\n山田");
    // 「名前」を Shift_JIS で
    const sjis = new Uint8Array([0x96, 0xbc, 0x91, 0x4f]);
    expect(decodeCsv(sjis)).toBe("名前");
  });

  it("書き出しは UTF-8 BOM 付き・CRLF で、特殊文字はクォートする", () => {
    const csv = toCsv([
      ["名前", "金額"],
      ["山田, 太郎", 1000],
      ['"引用"', null],
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe('﻿名前,金額\r\n"山田, 太郎",1000\r\n"""引用""",\r\n');
    expect(parseCsv(csv.slice(1))).toEqual([
      ["名前", "金額"],
      ["山田, 太郎", "1000"],
      ['"引用"', ""],
    ]);
  });
});

describe("口座情報（1つのセル）を分ける", () => {
  it("銀行・支店・種別・番号", () => {
    expect(parseBankCell("ダミー銀行　駅前支店　普通　1234567")).toEqual({
      bank_name: "ダミー銀行",
      bank_branch: "駅前支店",
      account_type: "ordinary",
      account_number: "1234567",
    });
  });

  it("全角数字・区切りのゆれ・当座", () => {
    expect(parseBankCell("ダミー信用金庫 本店 当座 ０１２３４５６")).toEqual({
      bank_name: "ダミー信用金庫",
      bank_branch: "本店",
      account_type: "checking",
      account_number: "0123456",
    });
  });

  it("支店が「支店」で終わらなくても順番で拾う", () => {
    expect(parseBankCell("ダミー銀行 さくら 普通 7654321")).toMatchObject({ bank_name: "ダミー銀行", bank_branch: "さくら", account_number: "7654321" });
  });
});
