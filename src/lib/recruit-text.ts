import { addDays, type DateString, resolveMonthDay } from "@/lib/date";

/**
 * 取引先からの募集の文（LINE）を読む（Phase 9）。読んだ内容は現場をまとめて作る画面の初期値にする。
 *
 * 読むもの:
 * - 日付: 「11/1・5・6・10」（月は前の日付から引きつぐ）、「10/12(月/祝)」、「11月5日」、「11/1〜11/3」。改行をまたいで続いてもよい
 * - 優遇日: 「優遇」と書いた見出し・行のあとの日付（募集日のうち、取引先が特に来てほしい日）
 * - 時間: 「11時〜19時」「10:30-18:30」（最初に出てきた1つ）
 * - 会場: 「稼働場所」「場所」「会場」「店舗」の行（またはその次の行）、なければ「▼〇〇」の行
 * - 役割と人数: 「クローザー：各日1名」「募集：クローザー1名」。「募集」と書いた行を先に、「※」で始まる行（体制の説明）はあとに
 * 金額（単価）は読まない。
 */

export type RecruitParse = {
  /** 募集日（YYYY-MM-DD、並べて重なりなし） */
  dates: DateString[];
  /** 優遇日（募集日のうち） */
  starred: DateString[];
  venue: string;
  start: string | null;
  end: string | null;
  /** 文の中にあった役割と人数（役割の名前は CRM の役割の名前） */
  roles: { name: string; count: number }[];
};

const nfkc = (s: string) => s.normalize("NFKC");

/** 比べるための形（空白・記号・大文字小文字・ひらがなとカタカナの違いをなくす） */
function key(s: string): string {
  return nfkc(s)
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[\s・/\\_\-‐−ー〜~:：()（）「」『』【】\[\]▼▽◆◇●○■□★☆※、。,.]/g, "");
}

const SEP = /[・、,，\s]+/;
const MD_RANGE = /^(\d{1,2})\s*[/月]\s*(\d{1,2})日?\s*[〜~～\-－]\s*(?:(\d{1,2})\s*[/月]\s*)?(\d{1,2})日?$/;
// 「11/5」「11月5日」「2026/11/5」（前に「〈募集日〉」「日程:」などが付いていてもよい）
const MD = /(?<![\d/])(?:\d{4}\s*[/年.\-]\s*)?(\d{1,2})\s*[/月]\s*(\d{1,2})日?/;
// 日だけ（前の月を引きつぐ）。最後の数字のあとに「に稼働可能な方」などが続いてもよい（名・人・時などが続くものは日付にしない）
const DAY = /^(\d{1,2})日?(?:$|(?=[^\d名人時分円件台:/月]))/;

function dateTokens(line: string, ctx: { month: number | null; today: DateString; continues: boolean }): DateString[] | null {
  const body = nfkc(line).replace(/\([^()]*\)/g, " ");
  const out: DateString[] = [];
  // 日だけの数字を読んでよいか（「11/5」のあと、または前の行から続く行の最初から）
  let reading = false;
  const tokens = body.split(SEP).filter(Boolean);
  for (const [i, t] of tokens.entries()) {
    const range = t.match(MD_RANGE);
    if (range) {
      const m1 = Number(range[1]);
      const from = resolveMonthDay(m1, Number(range[2]), ctx.today);
      const to = resolveMonthDay(range[3] ? Number(range[3]) : m1, Number(range[4]), ctx.today);
      if (from && to && from <= to) for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
      ctx.month = range[3] ? Number(range[3]) : m1;
      reading = true;
      continue;
    }
    const md = t.match(MD);
    if (md) {
      ctx.month = Number(md[1]);
      const d = resolveMonthDay(ctx.month, Number(md[2]), ctx.today);
      if (d) out.push(d);
      reading = true;
      // 「11/5に稼働可能な方」: 日付のあとに文が続いたら、その行の日付はおしまい
      if (md.index! + md[0].length < t.length) break;
      continue;
    }
    // 「11/5・6」の 6、または前の行から続く日（行の最初が日のとき）
    const day = t.match(DAY);
    if (day && ctx.month && (reading || (i === 0 && ctx.continues))) {
      const d = resolveMonthDay(ctx.month, Number(day[1]), ctx.today);
      if (d) out.push(d);
      reading = true;
      if (day[0].length < t.length) break;
      continue;
    }
    // 日付でないものが出てきたら、その行の日付はおしまい
    if (out.length) break;
  }
  return out.length ? out : null;
}

function readTime(h: string, m?: string, half?: string): string | null {
  const hh = Number(h);
  const mm = half ? 30 : m ? Number(m) : 0;
  if (hh > 23 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

const TIME_PART = String.raw`(\d{1,2})(?::(\d{2})|時(?:(\d{1,2})分|(半))?)`;
const TIME_RANGE = new RegExp(`${TIME_PART}\\s*(?:[〜~～\\-－ー]|から)\\s*${TIME_PART}`);

// 「■稼働場所」だけの行（次の行が会場）か、「場所：〇〇」の行
const VENUE_KEY = /^(?:[■□●◆]\s*|[【\[]\s*)?(?:稼働場所|開催場所|実施場所|場所|会場|店舗|現場)\s*(?:[】\]])?\s*(?:[:：]\s*(.*))?$/;

export function parseRecruitText(text: string, opts: { today: DateString; roleNames: string[] }): RecruitParse {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const dates = new Set<DateString>();
  const starred = new Set<DateString>();
  let venue = "";
  let venueFallback = "";
  let start: string | null = null;
  let end: string | null = null;
  const roleHits = new Map<string, { count: number; rank: number }>();

  const ctx = { month: null as number | null, today: opts.today, continues: false };
  let preferred = false;
  let prevDates = false;
  let wantVenue = false;

  for (const line of lines) {
    if (!line) {
      preferred = false;
      prevDates = false;
      continue;
    }
    const n = nfkc(line);

    // 見出し（■〇〇・〈〇〇〉・【〇〇】）が変わったら、優遇日の区切りもおしまい
    if (/^[■□●◆〈<【\[]/.test(n)) preferred = /優遇/.test(n);
    else if (/優遇/.test(n)) preferred = true;
    // 「日程：」「時間：」のような別の項目の行でも、優遇日の区切りはおしまい
    else if (/^[^\d:]{1,10}:/.test(n)) preferred = false;

    if (wantVenue) {
      venue = line.replace(/^[▼▽◆◇●○■□・\s]+/, "").trim();
      wantVenue = false;
      continue;
    }
    const vk = n.match(VENUE_KEY);
    if (vk && !venue) {
      if (vk[1]?.trim()) venue = vk[1].trim();
      else wantVenue = true;
      continue;
    }
    if (!venueFallback && /^[▼▽]/.test(n)) venueFallback = n.replace(/^[▼▽\s]+/, "").trim();

    const tm = n.match(TIME_RANGE);
    if (tm && !start) {
      start = readTime(tm[1], tm[2] ?? tm[3], tm[4]);
      end = readTime(tm[5], tm[6] ?? tm[7], tm[8]);
    }

    // 日付は、日付のある行と、その次に続く「14・15・16」のような行だけ読む（「各日1名」などを日付にしない）
    ctx.continues = prevDates && /^\d{1,2}日?(?:[・、,，\s]|$)/.test(n);
    const looksDates: boolean = /\d{1,2}\s*[/月]\s*\d{1,2}/.test(n) || ctx.continues;
    const ds: DateString[] | null = looksDates ? dateTokens(n, ctx) : null;
    prevDates = Boolean(ds);
    if (ds) for (const d of ds) (preferred ? starred : dates).add(d);

    for (const role of opts.roleNames) {
      const re = new RegExp(`${role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:：]?\\s*(?:各日|1日|毎日)?\\s*(\\d{1,2})\\s*(?:名|人)`);
      const m = n.match(re);
      if (!m) continue;
      const rank = /募集/.test(n) ? 0 : /^[※*＊]/.test(n) ? 2 : 1;
      const prev = roleHits.get(role);
      if (!prev || rank < prev.rank) roleHits.set(role, { count: Number(m[1]), rank });
    }
  }

  // 優遇日だけに書いてあって募集日にない日は、募集日にも入れる（募集日の書き忘れ・「優遇日」だけの文）
  for (const d of starred) dates.add(d);
  const sorted = [...dates].sort();
  return {
    dates: sorted,
    starred: [...starred].filter((d) => dates.has(d)).sort(),
    venue: venue || venueFallback,
    start,
    end,
    roles: opts.roleNames.filter((r) => roleHits.has(r)).map((name) => ({ name, count: roleHits.get(name)!.count })),
  };
}

/** 読んだ会場名に合う CRM の会場を探す（同じ名前 → 含む・含まれる名前のうち長いもの）。なければ null */
export function matchVenue<T extends { id: string; name: string }>(text: string, venues: T[]): T | null {
  const k = key(text);
  if (!k) return null;
  const exact = venues.find((v) => key(v.name) === k);
  if (exact) return exact;
  const hits = venues.filter((v) => {
    const vk = key(v.name);
    return vk.length >= 2 && (k.includes(vk) || vk.includes(k));
  });
  return hits.sort((a, b) => key(b.name).length - key(a.name).length)[0] ?? null;
}

/** 開始時刻の30分前（集合時刻の初期値） */
export function minutesBefore(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const t = Math.max(0, h * 60 + m - minutes);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
