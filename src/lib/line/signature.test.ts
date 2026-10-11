import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractLinkCode, verifyLineSignature } from "./signature";

describe("LINE の受け口の確かめ", () => {
  const secret = "test-secret";
  const body = JSON.stringify({ events: [{ type: "message" }] });
  const sign = (b: string, s = secret) => createHmac("sha256", s).update(b).digest("base64");

  it("正しい署名なら通す", () => {
    expect(verifyLineSignature(body, sign(body), secret)).toBe(true);
  });

  it("署名がない・違う・本文が書き換えられた・シークレットが違うときは通さない", () => {
    expect(verifyLineSignature(body, null, secret)).toBe(false);
    expect(verifyLineSignature(body, "abc", secret)).toBe(false);
    expect(verifyLineSignature(`${body} `, sign(body), secret)).toBe(false);
    expect(verifyLineSignature(body, sign(body, "other"), secret)).toBe(false);
    expect(verifyLineSignature(body, sign(body), "")).toBe(false);
  });
});

describe("つなぐコードの取り出し", () => {
  it("「連携コード ABCD2345」から取り出す。全角・小文字・ハイフンも吸収する", () => {
    expect(extractLinkCode("連携コード ABCD2345")).toBe("ABCD2345");
    expect(extractLinkCode("ａｂｃｄ２３４５")).toBe("ABCD2345");
    expect(extractLinkCode("abcd-2345")).toBe("ABCD2345");
  });

  it("コードがない文は null", () => {
    expect(extractLinkCode("こんにちは")).toBeNull();
    expect(extractLinkCode("1234")).toBeNull();
  });
});
