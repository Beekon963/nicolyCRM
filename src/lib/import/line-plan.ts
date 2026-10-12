/**
 * LINE のトーク履歴の取り込み（Phase 11）: 読み取った書き方（人・会場・項目）を CRM のものに当てて、
 * サーバーに送る「何を入れるか」を組み立てる。当て方は画面で選び直せる（ここは最初の案と、組み立てだけ）
 */
import { roundCount, sumCounts } from "@/lib/count";
import type { LineReport } from "./line-history";

type Named = { id: string; name: string };

/** 会場の名前を比べる形（「DS」と「ドコモショップ」は同じ、「店内・外販・軒先」などは外す） */
export function venueKey(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[（(][^)）]*[)）]/g, "")
    .replace(/ドコモショップ|docomoショップ|docomo\s*shop/g, "ds")
    .replace(/店内|外販|軒先|催事|イベント|ヘルパー|店$|店(?=\s)/g, "")
    .replace(/[\s・/\\_\-‐−ー〜~:：「」『』【】[\]▼▽◆◇●○■□★☆※、。,.]/g, "");
}

/** 読み取った会場に合う CRM の会場（同じ → 含む・含まれるもののうち一番近い長さ）。なければ null */
export function suggestVenue(text: string, venues: Named[]): string | null {
  const k = venueKey(text);
  if (k.length < 2) return null;
  const keyed = venues.map((v) => ({ id: v.id, k: venueKey(v.name) })).filter((v) => v.k.length >= 2);
  const exact = keyed.find((v) => v.k === k);
  if (exact) return exact.id;
  // 「ds」を外した地名だけでも比べる（「テスト東」→「DSテスト東」）
  const bare = (s: string) => s.replace(/^ds/, "");
  const hits = keyed.filter((v) => v.k.includes(k) || k.includes(v.k) || (bare(k).length >= 2 && bare(v.k) === bare(k)));
  if (!hits.length) return null;
  return hits.sort((a, b) => Math.abs(a.k.length - k.length) - Math.abs(b.k.length - k.length))[0].id;
}

const personKey = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\s・]/g, "")
    .replace(/(さん|サン|くん|クン|ちゃん|チャン)$/, "");

/**
 * 書いてあった名前に合うスタッフ。名前（空白なし）・ふりがな・LINE の表示名 が同じ、または名字だけ・名前だけが1人だけに合うとき。
 * 同じ名字の人が2人以上いるときは決めない（画面で選んでもらう）
 */
export function suggestStaff(name: string, staff: (Named & { kana: string; line_name?: string })[]): string | null {
  const k = personKey(name);
  if (!k) return null;
  const full = staff.filter((s) => personKey(s.name) === k || personKey(s.kana) === k || (s.line_name && personKey(s.line_name) === k));
  if (full.length === 1) return full[0].id;
  if (full.length > 1) return null;
  if (k.length < 2) return null;
  const part = staff.filter((s) => {
    const n = personKey(s.name);
    const kana = personKey(s.kana);
    const [sei, mei] = s.name.normalize("NFKC").split(/[\s　]+/);
    return n.startsWith(k) || kana.startsWith(k) || (mei != null && personKey(mei) === k) || (sei != null && k.startsWith(personKey(sei)) && personKey(sei).length >= 2);
  });
  return part.length === 1 ? part[0].id : null;
}

/** 読み取った書き方の一覧（よく出てくる順） */
export function distinct(values: string[]): { value: string; count: number }[] {
  const m = new Map<string, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "ja"));
}

export type LineEntry = {
  date: string;
  venueId: string;
  /** その日に現場がないとき、作る現場の取引先 */
  clientId: string;
  /** 送った時刻と送った人（結果の画面で見分けるため） */
  label: string;
  people: { staffId: string; counts: { itemId: string; count: number }[] }[];
};

export type LineSkip = { label: string; reason: string };

/**
 * 当て方（書き方 → CRM の id。null は「取り込まない」「数えない」）から、サーバーに送る内容を作る。
 * - 会場・人が決まっていない報告や、数える項目が1つもない報告（獲得なしの報告は別）は入れない
 * - 同じ人に当たった名前・同じ項目に当たった書き方は件数を足す
 */
export function buildEntries(
  reports: LineReport[],
  maps: { venue: Record<string, string | null>; person: Record<string, string | null>; item: Record<string, string | null>; client: Record<string, string> },
): { entries: LineEntry[]; skipped: LineSkip[] } {
  const entries: LineEntry[] = [];
  const skipped: LineSkip[] = [];
  for (const r of reports) {
    const label = `${r.date.slice(5).replace("-", "/")} ${r.venue || "（会場なし）"}（${r.sender} ${r.time}）`;
    const venueId = r.venue ? maps.venue[r.venue] : null;
    if (!venueId) {
      skipped.push({ label, reason: "会場を選んでいません" });
      continue;
    }
    const clientId = maps.client[venueId] ?? "";
    const counted = r.lines.filter((l) => maps.item[l.raw]);
    if (!counted.length && !r.zero) {
      skipped.push({ label, reason: "数える項目がありません" });
      continue;
    }
    const byStaff = new Map<string, Map<string, number>>();
    for (const p of r.people) {
      const id = maps.person[p];
      if (id && !byStaff.has(id)) byStaff.set(id, new Map());
    }
    for (const l of counted) {
      for (const s of l.shares) {
        const id = maps.person[s.person];
        if (!id) continue;
        const items = byStaff.get(id) ?? new Map<string, number>();
        const itemId = maps.item[l.raw]!;
        items.set(itemId, sumCounts([items.get(itemId), s.count]));
        byStaff.set(id, items);
      }
    }
    if (!byStaff.size) {
      skipped.push({ label, reason: "人を選んでいません" });
      continue;
    }
    entries.push({
      date: r.date,
      venueId,
      clientId,
      label,
      people: [...byStaff].map(([staffId, items]) => ({ staffId, counts: [...items].map(([itemId, count]) => ({ itemId, count: roundCount(count) })).filter((c) => c.count > 0) })),
    });
  }
  return { entries, skipped };
}
