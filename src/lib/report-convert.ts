/**
 * LINE に書いた報告（NICOLY のいつもの書き方）を、取引先の公認名称・書式に直す（Phase 8）。
 *
 * - 項目名は「取引先で使う獲得項目の名前」に合わせる。合わせ方は
 *   ①そのまま同じ名前 → ②言いかえ表（設定で登録。例: キヘン → 機種変更）→ ③よくある言いかえ（下の SYNONYMS）と部分一致で推測 → ④わからない
 * - 推測（黄）とわからない（赤）は、画面で人が選び直せる。オーナーはその言いかえを覚えさせられる
 * - 「（仮）」が付いた項目は、同じ名前に「（仮）」が付いた項目に入れる（光・カードの仮申し込み）
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

const PROVISIONAL = /\(仮\)/;
const stripProvisional = (n: string) => n.replace(/\(仮\)/g, "");

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
  const provisional = PROVISIONAL.test(n);
  const base = stripProvisional(n);
  const byKey = new Map(dict.items.map((name) => [normalizeName(name), name]));
  const aliasKey = new Map(dict.aliases.map((a) => [normalizeName(a.alias), a.name]));

  // 「（仮）」つきの名前そのものが言いかえ表・項目にあれば、それを使う
  if (provisional) {
    const direct = byKey.get(n) ?? aliasKey.get(n);
    if (direct) return { name: direct, how: byKey.has(n) ? "exact" : "alias", candidates: [] };
  }

  const toProvisional = (r: Resolved): Resolved => {
    if (!provisional || !r.name) return r;
    const key = normalizeName(r.name) + "(仮)";
    const hit = byKey.get(key);
    return hit ? { ...r, name: hit } : { name: null, how: "unknown", candidates: [`${r.name}（仮）`] };
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
    .filter((c) => !PROVISIONAL.test(c.k) && (c.k.includes(key) || (c.k.length >= 2 && key.includes(c.k))))
    .sort((a, b) => guessScore(a.k, key) - guessScore(b.k, key) || a.k.length - b.k.length)
    .map((c) => c.name);
  if (cands.length) return toProvisional({ name: cands[0], how: "guess", candidates: cands });
  return { name: null, how: "unknown", candidates: [] };
}

export type ParsedLine = { raw: string; count: number };
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

/** 「項目 件数」の1行を読む。読めなければ null */
export function parseItemLine(line: string): ParsedLine | null {
  const n = soft(line).trim();
  // 「ドコモ光 1G 1」「あんしんセキュリティ999 1」: 最後の空白のあとが件数
  let m = n.match(new RegExp(`^(.+?)\\s+(\\d+)\\s*${UNIT}$`));
  // 「MAX×2」「光：1」「Pixel=2」「MAX x 2」
  if (!m) m = n.match(new RegExp(`^(.+?)\\s*(?:[:=×*]|\\s[xX])\\s*(\\d+)\\s*${UNIT}$`));
  // 「機種変更2件」（件などが付いているときだけ、区切りなしでも読む）
  if (!m) m = n.match(/^(.*[^\d\s])(\d+)\s*(?:件|台|本|枚|個|回)$/);
  if (!m) return null;
  const raw = m[1].trim().replace(/[:：]$/, "").trim();
  // 日付（10/11）だけの行は項目にしない
  if (/^\d{1,2}\/$/.test(raw)) return null;
  if (!raw) return null;
  return { raw, count: Number(m[2]) };
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

/**
 * LINE に書いた報告の文を読む。
 * - 【実績】【獲得】などの見出しのあとは「項目 件数」、【所感】【コメント】のあとはコメント
 * - 「日付：」「稼働者：」「現場：」の行、見出しより前の件数のない行（日付・現場名・名前）も読む
 * - 【〇〇公認名称】のような項目の一覧は読まない
 */
export function parseReportText(text: string): ParsedReport {
  const out: ParsedReport = { date: "", venue: "", workers: [], lines: [], comment: "", unreadable: [] };
  const comment: string[] = [];
  let section: "none" | "items" | "comment" | "ignore" = "none";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      if (section === "comment" && comment.length) comment.push("");
      continue;
    }
    const n = line.normalize("NFKC");
    const head = n.match(/^[【\[［]([^】\]］]+)[】\]］]\s*(.*)$/);
    if (head) {
      const title = head[1];
      if (/名称|一覧|ルール|コメント欄/.test(title) && !/所感/.test(title)) section = "ignore";
      else if (/所感|感想|コメント|備考|メモ|一言/.test(title)) {
        section = "comment";
        if (head[2].trim()) comment.push(head[2].trim());
      } else if (/実績|獲得|結果|件数|成果/.test(title)) section = "items";
      else section = "none";
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
    const item = parseItemLine(line);
    if (item) {
      out.lines.push(item);
      continue;
    }
    // 見出しより前で件数のない行: 日付 → 現場 → 名前 の順に読む
    if (section === "none" && out.lines.length === 0) {
      const d = normalizeDateLabel(n);
      if (d && !out.date && /^\d/.test(n)) out.date = d;
      else if (!out.venue) out.venue = line;
      else out.workers.push(...splitNames(line));
      continue;
    }
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

/** 同じ項目は件数を足す（取引先の項目の並び順にそろえ、知らない名前は後ろに） */
export function mergeCounts(lines: { name: string; count: number }[], order: string[]): { name: string; count: number }[] {
  const sum = new Map<string, number>();
  for (const l of lines) sum.set(l.name, (sum.get(l.name) ?? 0) + l.count);
  const pos = new Map(order.map((n, i) => [n, i]));
  return [...sum.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (pos.get(a.name) ?? Infinity) - (pos.get(b.name) ?? Infinity));
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
