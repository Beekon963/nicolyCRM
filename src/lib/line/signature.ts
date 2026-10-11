import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * LINE の受け口（webhook）に届いたものが本当に LINE から来たか確かめる。
 * 本文を「チャネルシークレット」で HMAC-SHA256 にして base64 にしたものが、x-line-signature と同じなら本物。
 */
export function verifyLineSignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(body, "utf8").digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** 送られた文からつなぐコード（8文字）を取り出す。全角・小文字・ハイフン・空白は吸収する */
export function extractLinkCode(text: string): string | null {
  const s = text.normalize("NFKC").toUpperCase().replace(/[\s\-ー－]/g, "");
  const m = s.match(/[A-Z0-9]{8}/g);
  if (!m) return null;
  // 「連携コード ABCD2345」の形なら、コードの部分だけ（紛らわしい文字を除いた文字だけでできているもの）
  return m.find((c) => /^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{8}$/.test(c)) ?? null;
}
