/**
 * 稼働表のチップに出す短い名前（Phase 22）: 「キャリア 場所」（例: docomo 村山）。
 * 場所は会場の「場所の短い名前」。空なら会場名からチェーン名などを外して先頭を使う。
 * 画面に依存しない形にして、テストで確かめる
 */
import { CARRIER_LABEL, isCarrier } from "@/lib/carriers";

/** 会場名の先頭に付きがちなチェーン名・店の種類（長いものを先に） */
const PREFIXES = [
  "三井ショッピングパーク",
  "ショッピングセンター",
  "ショッピングモール",
  "コジマ×ビックカメラ",
  "ヨドバシカメラ",
  "ビックカメラ",
  "ヤマダデンキ",
  "ヤマダ電機",
  "ケーズデンキ",
  "ドコモショップ",
  "docomo shop",
  "イオンモール",
  "イオンタウン",
  "ららぽーと",
  "エディオン",
  "auショップ",
  "ソフトバンク",
  "イオン",
  "コジマ",
  "ノジマ",
  "DS",
];

/** 会場名から短い名前を作る（8文字以内ならそのまま、長ければチェーン名を外して先頭6文字） */
export function autoShortName(name: string): string {
  let s = name.normalize("NFKC").replace(/\s+/g, "");
  if (!s) return "";
  const lower = s.toLowerCase();
  const p = PREFIXES.find((x) => lower.startsWith(x.toLowerCase()) && s.length > x.length);
  if (p) s = s.slice(p.length).replace(/^[・･\-－]+/, "");
  const chars = [...s];
  return chars.length <= 8 ? s : chars.slice(0, 6).join("");
}

/** チップの文字: 「キャリア 場所」。キャリアが未設定なら場所だけ */
export function chipLabel(x: { venueName: string; venueShort?: string | null; carrier?: string | null }): string {
  const place = (x.venueShort ?? "").trim() || autoShortName(x.venueName);
  const carrier = isCarrier(x.carrier) ? CARRIER_LABEL[x.carrier] : "";
  return [carrier, place].filter(Boolean).join(" ");
}
