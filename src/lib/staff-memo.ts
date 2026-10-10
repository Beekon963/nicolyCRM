/**
 * スタッフのメモを見やすく分ける。
 * 名簿の取り込みでは、要件にない列（キャッチ力・クローザー力・知識・誓約書など。Phase 0 決定8）を
 * 「列名: 値」の形でメモにまとめて入れている（古い取り込みは「 / 」区切りの1行、新しい取り込みは1項目1行）。
 * 画面では「列名: 値」を項目ごとの表にし、ふつうのメモ（備考など）は文章のまま上に出す。
 */

export type MemoItem = { label: string; value: string };
export type MemoGroup = { title: string; items: MemoItem[] };
export type ParsedMemo = { notes: string[]; groups: MemoGroup[] };

/** 項目のまとまり（上から順に当てはめ、どれにも当たらなければ「そのほか」） */
const GROUPS: { title: string; match: RegExp }[] = [
  { title: "スキル・経験", match: /キャッチ|クローザー|立ち回り|知識|経験|旧ランク|スキル|キャリア/ },
  { title: "実績", match: /実績|獲得|入店|店舗/ },
  { title: "人柄・強み", match: /人柄|強み|性格|印象/ },
  { title: "手続き", match: /誓約|受理|口座登録|契約|書類/ },
  { title: "連絡先", match: /メール|mail/i },
];
const OTHER = "そのほか";

/** 文章として出す列（「メモ: …」「備考: …」） */
const NOTE_LABELS = /^(メモ|備考|要確認メモ|その他)$/;

/** 「列名: 値」の列名として認めるもの（「18:00以降」の 18 や URL を列名と取り違えない） */
function asLabeled(segment: string): MemoItem | null {
  const m = /^([^:：\n]{1,20}?)\s*[:：]\s*([\s\S]*)$/.exec(segment);
  if (!m) return null;
  const label = m[1].trim();
  if (!label || /^[\d\s０-９]+$/.test(label) || /^https?$/i.test(label)) return null;
  return { label, value: m[2].trim() };
}

export function parseStaffMemo(memo: string | null | undefined): ParsedMemo {
  const notes: string[] = [];
  const items: MemoItem[] = [];
  for (const line of (memo ?? "").split(/\r?\n/)) {
    let last: MemoItem | null = null;
    for (const raw of line.split(/\s+\/\s+/)) {
      const seg = raw.trim();
      if (!seg) continue;
      const item = asLabeled(seg);
      if (item && NOTE_LABELS.test(item.label)) {
        if (item.value) notes.push(item.value);
        last = null;
      } else if (item) {
        items.push(item);
        last = item;
      } else if (last) {
        // 値の中の「 / 」（例: 知識: docomo / au）は、前の項目の続き
        last.value = `${last.value} / ${seg}`;
      } else {
        notes.push(seg);
      }
    }
  }
  const groups: MemoGroup[] = [...GROUPS.map((g) => g.title), OTHER]
    .map((title) => ({ title, items: [] as MemoItem[] }));
  for (const it of items.filter((x) => x.value)) {
    const i = GROUPS.findIndex((g) => g.match.test(it.label));
    groups[i >= 0 ? i : groups.length - 1].items.push(it);
  }
  return { notes, groups: groups.filter((g) => g.items.length) };
}

/** 値の色分け（○・済などは緑、未・未提出などは黄＝待ち、×・なしなどは灰色。要件 §9-5 の色の決まり） */
export function memoValueTone(value: string): "good" | "waiting" | "muted" | null {
  const v = value.trim();
  if (/^(○|◯|〇|◎|済|済み|あり|有|はい|OK|受理|受理済み?|送付済み?|登録済み?)$/i.test(v)) return "good";
  if (/^(未|未提出|未送付|未受理|未登録)$/.test(v)) return "waiting";
  if (/^(×|✕|✖|なし|無|いいえ|NG|-|－)$/i.test(v)) return "muted";
  return null;
}

/**
 * 編集画面では1項目1行にして直しやすくする（「 / 」区切りの古い形も、項目の区切りだけ改行にする）。
 * 中身は変えない。
 */
export function memoForEdit(memo: string | null | undefined): string {
  return (memo ?? "")
    .split(/\r?\n/)
    .map((line) => {
      const segs = line.split(/\s+\/\s+/);
      let out = segs[0] ?? "";
      for (const seg of segs.slice(1)) out += asLabeled(seg.trim()) ? `\n${seg.trim()}` : ` / ${seg}`;
      return out;
    })
    .join("\n");
}
