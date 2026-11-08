/**
 * 取引先が扱うキャリア（Phase 22）。稼働表のチップの短い名前（「docomo 村山」）の前半に使う。
 * DB の companies.carrier は text（check 制約）。空 = 未設定
 */
export const CARRIERS = ["docomo", "au", "softbank", "rakuten", "other"] as const;
export type Carrier = (typeof CARRIERS)[number];

/** 画面に出す書き方 */
export const CARRIER_LABEL: Record<Carrier, string> = { docomo: "docomo", au: "au", softbank: "SoftBank", rakuten: "楽天", other: "その他" };

export function isCarrier(v: unknown): v is Carrier {
  return typeof v === "string" && (CARRIERS as readonly string[]).includes(v);
}

/** CSV などの書き方（「ドコモ」「SoftBank」「楽天モバイル」）をキャリアに直す。空は未設定、知らない書き方は「その他」 */
export function parseCarrier(raw: string | null | undefined): Carrier | "" {
  const s = (raw ?? "").normalize("NFKC").trim().toLowerCase();
  if (!s) return "";
  if (/docomo|ドコモ|ds/.test(s)) return "docomo";
  if (/^au|エーユー|kddi/.test(s)) return "au";
  if (/softbank|ソフトバンク|^sb/.test(s)) return "softbank";
  if (/rakuten|楽天/.test(s)) return "rakuten";
  return "other";
}
