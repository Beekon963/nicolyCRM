/**
 * LINE に書いた報告（NICOLY のいつもの書き方）を、取引先の公認名称・書式に直す（Phase 8・9）。
 *
 * - 項目名は「取引先で使う獲得項目の名前」に合わせる。合わせ方は
 *   ①そのまま同じ名前 → ②言いかえ表（設定で登録。例: キヘン → 機種変更）→ ③よくある言いかえ（下の SYNONYMS）と部分一致で推測 → ④わからない
 * - 推測（黄）とわからない（赤）は、画面で人が選び直せる。オーナーはその言いかえを覚えさせられる
 * - 「（仮）」が付いた項目は、同じ名前に「（仮）」が付いた項目に入れる（光・カードの仮申し込み）
 * - 「後日」の見出しの下の項目は、同じ名前に「（後日）」が付いた項目に入れる（当日の獲得と分けて数える）
 * - NICOLY フォーマット: 「新規1(山田)」のように件数のあとに獲得した人の名前、項目の下の行（乗り換え元・端末など）はメモ
 * - 金額は扱わない
 */

export type NameDict = {
  /** 取引先で使う獲得項目の名前（並び順どおり） */
  items: string[];
  /** 言いかえ表（書き方 → 項目の名前） */
  aliases: { alias: string; name: string }[];
};

export type ResolveHow = "exact" | "alias" | "guess" | "unknown";
export type Resolved = { name: string | null; how: ResolveHow; candidates: string[] };

/** 比べるための形（全角・半角、大文字・小文字、ひらがな・カタカナ、空白・中黒・スラッシュの違いを吸収） */
export function normalizeName(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\s・/\\_\-‐−]/g, "");
}

/** 項目名に付ける印（比べる形では半角のかっこ）。「（仮）」= 仮申し込み、「（後日）」= 後日の獲得 */
const TAG = /\((仮|後日)\)/g;
const HAS_TAG = /\((仮|後日)\)/;
const tagsOf = (n: string) => [...n.matchAll(TAG)].map((m) => m[1]);

/**
 * よくある言いかえ（取引先によらない一般的な略し方）。比べる前に置きかえてから部分一致で推測する。
 * 取引先ごとの言いかえは設定の「言いかえ表」で足す
 */
const SYNONYMS: [RegExp, string][] = [
  [/^(キヘン|機変|キシュヘン)$/, "機種変更"],
  [/^(ノリカエ|乗換|乗り換え)$/, "mnp"],
  [/^シンキ$/, "新規"],
  [/プラチナ/, "platinum"],
  [/ゴールド/, "gold"],
  [/^アマプラ$/, "amazonプライム"],
  [/^アマゾン/, "amazon"],
  [/^ネトフリ$/, "netflix"],
  [/^(ユーチューブ|ヨウツベ)/, "youtube"],
  [/^ディズニー/, "disney"],
  [/^スポティファイ|^スポティ/, "spotify"],
  [/^スイッチ$/, "switch"],
  [/^グーグルワン$/, "googleone"],
  [/^ピクセル/, "pixel"],
  [/デンキ/, "電気"],
  [/ホーム5g/, "home5g"],
];

function synonym(n: string): string {
  for (const [re, to] of SYNONYMS) if (re.test(n)) return n.replace(re, to);
  return n;
}

/** 推測のときの順位（小さいほど先）。ドコモの商品は「ドコモ〇〇」「ｄカード〇〇」が本命になりやすい */
function guessScore(cand: string, raw: string): number {
  if (["ドコモ", "d", "dカード"].some((p) => cand === p + raw)) return 0;
  if (cand.startsWith(raw) || cand.endsWith(raw)) return 1;
  return 2;
}

/** 1つの項目名を、取引先の項目の名前に合わせる */
export function resolveItemName(raw: string, dict: NameDict): Resolved {
  const n = normalizeName(raw);
  const tags = tagsOf(n);
  const base = n.replace(TAG, "");
  const byKey = new Map(dict.items.map((name) => [normalizeName(name), name]));
  const aliasKey = new Map(dict.aliases.map((a) => [normalizeName(a.alias), a.name]));

  // 「（仮）」「（後日）」つきの名前そのものが言いかえ表・項目にあれば、それを使う
  if (tags.length) {
    const direct = byKey.get(n) ?? aliasKey.get(n);
    if (direct) return { name: direct, how: byKey.has(n) ? "exact" : "alias", candidates: [] };
  }

  // 印つきなら、当てた項目に同じ印が付いた項目にする（なければ「選んでください」）
  const toProvisional = (r: Resolved): Resolved => {
    if (!tags.length || !r.name) return r;
    const key = normalizeName(r.name).replace(TAG, "") + tags.map((t) => `(${t})`).join("");
    const hit = byKey.get(key);
    return hit ? { ...r, name: hit } : { name: null, how: "unknown", candidates: [`${r.name.replace(/[（(](仮|後日)[)）]/g, "")}${tags.map((t) => `（${t}）`).join("")}`] };
  };

  const exact = byKey.get(base);
  if (exact) return toProvisional({ name: exact, how: "exact", candidates: [] });
  const alias = aliasKey.get(base);
  if (alias) return toProvisional({ name: alias, how: "alias", candidates: [] });

  // 推測: よくある言いかえで置きかえてから、部分一致（「仮」の項目は除く）
  const key = synonym(base);
  const exact2 = byKey.get(key);
  if (exact2 && key !== base) return toProvisional({ name: exact2, how: "guess", candidates: [exact2] });
  if (!key) return { name: null, how: "unknown", candidates: [] };
  const cands = dict.items
    .map((name) => ({ name, k: normalizeName(name) }))
    .filter((c) => !HAS_TAG.test(c.k) && (c.k.includes(key) || (c.k.length >= 2 && key.includes(c.k))))
    .sort((a, b) => guessScore(a.k, key) - guessScore(b.k, key) || a.k.length - b.k.length)
    .map((c) => c.name);
  if (cands.length) return toProvisional({ name: cands[0], how: "guess", candidates: cands });
  return { name: null, how: "unknown", candidates: [] };
}

export type ParsedLine = {
  raw: string;
  count: number;
  /** 件数のあとのかっこの名前（「新規1(山田)」の山田）。獲得した人 */
  person?: string;
  /** 項目の下の行（乗り換え元・端末など）。件数には入れない */
  notes?: string[];
};
export type ParsedReport = {
  date: string;
  venue: string;
  workers: string[];
  lines: ParsedLine[];
  comment: string;
  /** 件数が読めなかった行（画面で知らせる） */
  unreadable: string[];
};

const UNIT = "(?:件|台|本|枚|個|回|名)?";

/**
 * 数字・区切り記号・空白だけ半角にする（1文字ずつ置きかえるので、項目名の書き方は元のまま残る。
 * 例: 「光（仮）　１」→「光（仮） 1」。全部を NFKC にすると「（仮）」が「(仮)」に変わり、画面の表示が書いたものと違ってしまう）
 */
function soft(s: string): string {
  return s.replace(/[０-９：＝＊×ｘＸ　]/g, (c) => {
    if (c === "　") return " ";
    if (c === "：") return ":";
    if (c === "＝") return "=";
    if (c === "＊") return "*";
    if (c === "ｘ" || c === "Ｘ") return "x";
    if (c === "×") return "×";
    return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
  });
}

/** 区切りなしで読んだ行（「DS〇〇2」のような現場名と見分けるため） */
const looseLines = new WeakSet<ParsedLine>();
const isLoose = (l: ParsedLine) => looseLines.has(l);

/**
 * 「項目 件数」の1行を読む。読めなければ null。
 * 最後のかっこは、獲得した人の名前（「新規1(山田)」）か印（「光1（仮）」）として読む
 */
export function parseItemLine(line: string): ParsedLine | null {
  const tail = soft(line)
    .trim()
    .match(/^(.*\d\s*(?:件|台|本|枚|個|回)?)\s*[（(]\s*([^（）()]+?)\s*[)）]$/);
  if (tail) {
    const inner = parseCountLine(tail[1]);
    if (!inner) return null;
    const out = /^(仮|後日)$/.test(tail[2]) ? { ...inner, raw: `${inner.raw}（${tail[2]}）` } : { ...inner, person: tail[2] };
    if (isLoose(inner)) looseLines.add(out);
    return out;
  }
  return parseCountLine(line);
}

function parseCountLine(line: string): ParsedLine | null {
  const n = soft(line).trim();
  // 「ドコモ光 1G 1」「あんしんセキュリティ999 1」: 最後の空白のあとが件数
  let m = n.match(new RegExp(`^(.+?)\\s+(\\d+)\\s*${UNIT}$`));
  // 「MAX×2」「光：1」「Pixel=2」「MAX x 2」
  if (!m) m = n.match(new RegExp(`^(.+?)\\s*(?:[:=×*]|\\s[xX])\\s*(\\d+)\\s*${UNIT}$`));
  // 「機種変更2件」（件などが付いているときだけ、区切りなしでも読む）
  if (!m) m = n.match(/^(.*[^\d\s])(\d+)\s*(?:件|台|本|枚|個|回)$/);
  // 「カード1」「RMMNP2」（区切りなしの1〜2けた。「あんしんセキュリティ999」のような3けたは名前の一部とみなす）
  let loose = false;
  if (!m) {
    m = n.match(/^(.*[^\d\s.,/:])(\d{1,2})$/);
    loose = Boolean(m);
  }
  if (!m) return null;
  const raw = m[1].trim().replace(/[:：]$/, "").trim();
  // 日付（10/11）だけの行は項目にしない
  if (/^\d{1,2}\/$/.test(raw)) return null;
  if (!raw) return null;
  const out = { raw, count: Number(m[2]) };
  if (loose) looseLines.add(out);
  return out;
}

const KEY_LINE = /^(日付|日にち|稼働日|現場|会場|店舗|場所|稼働者|名前|氏名|担当|スタッフ)\s*[:：]\s*(.*)$/;

/** 名前の並び（「山田、佐藤」「山田・佐藤」「山田 / 佐藤」）を分ける */
function splitNames(s: string): string[] {
  return s
    .split(/[、,，/／]|\s{2,}/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** 「10/11」「10月11日」「2026/10/11」を「10/11」に。読めなければ空 */
export function normalizeDateLabel(s: string): string {
  const n = s.normalize("NFKC");
  const m = n.match(/(?:\d{4}[/年.-])?(\d{1,2})\s*[/月.-]\s*(\d{1,2})/);
  return m ? `${Number(m[1])}/${Number(m[2])}` : "";
}

/** 「当日」「後日」の見出し（【当日】・当日分・後日獲得 なども） */
const TIMING = /^[【\[［]?\s*(当日|後日)\s*(?:分|獲得|の獲得|の分)?\s*[】\]］]?\s*[:：]?$/;
/** 日付で始まる行（「10/11 DS〇〇」の日付の部分） */
const DATE_HEAD = /^\s*(?:\d{4}[/年.\-])?\d{1,2}\s*[/月.\-]\s*\d{1,2}日?\s*(?:[（(][^)）]*[)）])?\s*/;

/**
 * LINE に書いた報告の文を読む。
 * - 【実績】【獲得】などの見出しのあとは「項目 件数」、【所感】【コメント】のあとはコメント
 * - 「日付：」「稼働者：」「現場：」の行、見出しより前の件数のない行（日付・現場名・名前。「10/11 DS〇〇」のように日付と現場が1行でもよい）も読む
 * - 「当日」「後日」の見出し: 後日の下の項目は「〇〇（後日）」として読む
 * - 項目の下の、件数のない行や取引先の項目にない行（乗り換え元・端末など）は、その項目のメモにする（空行までで1つの項目）
 * - 【〇〇公認名称】のような項目の一覧は読まない
 * dict（取引先の項目・言いかえ表）を渡すと、項目の名前だけの行（件数の書き忘れ）をメモにせず「件数が読めない」と知らせる
 */
export function parseReportText(text: string, dict?: NameDict): ParsedReport {
  const out: ParsedReport = { date: "", venue: "", workers: [], lines: [], comment: "", unreadable: [] };
  const comment: string[] = [];
  let section: "none" | "items" | "comment" | "ignore" = "none";
  let later = false;
  // 今の項目（空行まで）。その下の件数のない行はメモにする
  let current: ParsedLine | null = null;
  let noteMode = false;
  const known = (raw: string, guess: boolean) => {
    if (!dict) return false;
    const r = resolveItemName(raw, dict);
    return r.how === "exact" || r.how === "alias" || (guess && r.how === "guess");
  };
  const addNote = (line: string) => {
    if (!current) return false;
    current.notes = [...(current.notes ?? []), line];
    noteMode = true;
    return true;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      if (section === "comment" && comment.length) comment.push("");
      current = null;
      noteMode = false;
      continue;
    }
    const n = line.normalize("NFKC");
    const timing = n.match(TIMING);
    if (timing && section !== "comment") {
      later = timing[1] === "後日";
      section = "items";
      current = null;
      noteMode = false;
      continue;
    }
    const head = n.match(/^[【\[［]([^】\]］]+)[】\]］]\s*(.*)$/);
    if (head) {
      const title = head[1];
      if (/名称|一覧|ルール|コメント欄/.test(title) && !/所感/.test(title)) section = "ignore";
      else if (/所感|感想|コメント|備考|メモ|一言/.test(title)) {
        section = "comment";
        if (head[2].trim()) comment.push(head[2].trim());
      } else if (/実績|獲得|結果|件数|成果/.test(title)) section = "items";
      else section = "none";
      later = false;
      current = null;
      noteMode = false;
      continue;
    }
    if (section === "ignore") continue;
    if (section === "comment") {
      comment.push(line);
      continue;
    }
    const kv = soft(line).match(KEY_LINE);
    if (kv) {
      const [, key, value] = kv;
      if (/日付|日にち|稼働日/.test(key)) out.date = normalizeDateLabel(value) || value.trim();
      else if (/現場|会場|店舗|場所/.test(key)) out.venue = value.trim();
      else out.workers.push(...splitNames(value));
      continue;
    }
    const header = section === "none" && out.lines.length === 0;
    // 見出しより前の「10/11 DS〇〇」: 日付と現場
    if (header && !out.date && /^\d/.test(soft(line)) && normalizeDateLabel(n)) {
      out.date = normalizeDateLabel(n);
      const rest = soft(line).replace(DATE_HEAD, "").trim();
      if (rest && !out.venue) out.venue = rest;
      continue;
    }

    const item = parseItemLine(line);
    // 見出しより前の「DS〇〇2」は、取引先の項目に当たらなければ現場名など
    if (item && header && isLoose(item) && !known(item.raw, true)) {
      if (!out.venue) out.venue = line;
      else out.workers.push(...splitNames(line));
      continue;
    }
    if (item) {
      if (later && !/[（(]後日[)）]/.test(item.raw)) item.raw = `${item.raw}（後日）`;
      // メモの続き（「iPhone17×2」など）は、取引先の項目に当たらなければメモのまま
      if (noteMode && !known(item.raw, true) && addNote(line)) continue;
      out.lines.push(item);
      current = item;
      noteMode = false;
      continue;
    }
    // 見出しより前で件数のない行: 日付 → 現場 → 名前 の順に読む
    if (header) {
      const d = normalizeDateLabel(n);
      if (d && !out.date && /^\d/.test(n)) out.date = d;
      else if (!out.venue) out.venue = line;
      else out.workers.push(...splitNames(line));
      continue;
    }
    // 項目の名前だけの行は件数の書き忘れ。それ以外は、すぐ上の項目のメモ
    const bare = line.replace(/\s*[（(][^（）()]*[)）]\s*$/, "");
    if (!known(bare, false) && addNote(line)) continue;
    out.unreadable.push(line);
  }
  out.comment = comment.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return out;
}

export type ConvertedLine = ParsedLine & Resolved;

/** 読んだ行に、取引先の項目の名前を当てる */
export function resolveLines(lines: ParsedLine[], dict: NameDict): ConvertedLine[] {
  return lines.map((l) => ({ ...l, ...resolveItemName(l.raw, dict) }));
}

/** 同じ項目は件数を足す（取引先の項目の並び順にそろえ、知らない名前は後ろに）。メモはつなげる */
export function mergeCounts(lines: { name: string; count: number; notes?: string[] }[], order: string[]): { name: string; count: number; notes?: string[] }[] {
  const sum = new Map<string, { count: number; notes: string[] }>();
  for (const l of lines) {
    const cur = sum.get(l.name) ?? { count: 0, notes: [] };
    sum.set(l.name, { count: cur.count + l.count, notes: [...cur.notes, ...(l.notes ?? [])] });
  }
  const pos = new Map(order.map((n, i) => [n, i]));
  return [...sum.entries()]
    .map(([name, v]) => (v.notes.length ? { name, count: v.count, notes: v.notes } : { name, count: v.count }))
    .sort((a, b) => (pos.get(a.name) ?? Infinity) - (pos.get(b.name) ?? Infinity));
}

/** 「新規1(山田)」の山田を、稼働者の名前（山田 太郎）にそろえる。合う人がいなければそのまま */
export function matchPerson(tag: string, names: string[]): string | null {
  const k = normalizeName(tag);
  if (!k) return null;
  const keyed = names.map((n) => ({ n, nk: normalizeName(n) })).filter((x) => x.nk);
  return (keyed.find((x) => x.nk === k) ?? keyed.find((x) => x.nk.startsWith(k) || k.startsWith(x.nk)))?.n ?? null;
}

/**
 * CRM に入っている実績の項目名を、取引先の名前に直す（日報を作るとき）。
 * そのまま同じ名前か言いかえ表にあるときだけ直す（推測では変えない）。直した結果、同じ名前になった項目は件数を足す
 */
export function renameItems(items: { name: string; count: number | null }[], dict: NameDict): { name: string; count: number | null }[] {
  if (!dict.aliases.length) return items;
  const out: { name: string; count: number | null }[] = [];
  for (const i of items) {
    const r = resolveItemName(i.name, dict);
    const name = r.name && (r.how === "exact" || r.how === "alias") ? r.name : i.name;
    const same = out.find((o) => o.name === name);
    if (!same) out.push({ name, count: i.count });
    else if (i.count != null) same.count = (same.count ?? 0) + i.count;
  }
  return out;
}
