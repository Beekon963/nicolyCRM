/**
 * 「LINE の文を貼るだけ」（Phase 18）の読み取り。DB を使わない部分。
 *
 * 貼られた文が何かを見分ける（優先順）:
 * 1. 案件詳細（【案件詳細】・●集合場所）→ 会場のメモ
 * 2. 募集の文（日付が並び、会場か役割がある）→ 現場を作る画面へ
 * 3. 件数の報告（NICOLY フォーマット / いつもの書き方）→ 速報の確認カード
 * 4. 稼働可能日（日付と ○△× が並ぶ）→ 稼働可能日の確認カード
 * 5. 打診の返事（「参加できます」「無理です」など短い文）→ 返事待ちの一覧
 * 6. 分からない → AI に渡す
 * ここでは見分けと読み取りだけをして、CRM の現場・人・項目への当てはめはサーバー側（actions）で行う。
 */
import { addDays, isDateString, monthOf, nextMonth, parse, resolveMonthDay, type DateString } from "@/lib/date";
import { type LineDetailPost, type LineReport, readDetailPost, readReport } from "@/lib/import/line-history";
import { parseRecruitText, type RecruitParse } from "@/lib/recruit-text";
import { type NameDict, type ParsedReport, parseReportText } from "@/lib/report-convert";

export type AvailabilityStatus = "ok" | "maybe" | "ng";
export type AvailabilityParse = {
  /** 文から分かった月（YYYY-MM）。書いてなければ、集めている月 */
  month: string;
  days: { date: DateString; status: AvailabilityStatus }[];
  /** 日付か印が読めなかった行 */
  unread: string[];
};

export type PasteKind = "details" | "recruit" | "report" | "availability" | "reply" | "unknown";

export type Classified =
  | { kind: "details"; detail: LineDetailPost }
  | { kind: "recruit"; recruit: RecruitParse }
  | { kind: "report"; nicoly: ParsedReport | null; line: LineReport | null }
  | { kind: "availability"; availability: AvailabilityParse }
  | { kind: "reply"; positive: boolean }
  | { kind: "unknown" };

const nfkc = (s: string) => s.normalize("NFKC");

const OK = /^(?:[○◯〇⭕️⭕]|OK|ok|Ok|可|参加|行けます|いけます|空いてます|空いています|大丈夫)$/u;
const MAYBE = /^(?:[△▲🔺]|たぶん|多分|調整|要相談|未定|午前|午後|AM|PM|am|pm)$/u;
const NG = /^(?:[×✕✖❌✗]|NG|ng|Ng|不可|無理|休み|休|行けません|いけません|ダメ|だめ)$/u;

function markOf(s: string): AvailabilityStatus | null {
  const t = s.replace(/️/g, "");
  if (OK.test(t)) return "ok";
  if (MAYBE.test(t)) return "maybe";
  if (NG.test(t)) return "ng";
  return null;
}

/** 月の日数 */
function daysInMonth(month: string): number {
  const { y, m } = parse(`${month}-01`);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * 稼働可能日の文を読む。「11/1 ○」「1日 ×」「1,2,5 ○ / 10 △ / 他 ×」「○: 1 2 3」「11月: 1〜5○ 6×」「全部○」などを読む。
 * 印は、同じ行の前の日付に付く（行が印で始まるときは、後ろの日付に付く）。
 * 月は「11月」「11/1」から。書いてなければ defaultMonth（集めている月）。
 */
export function parseAvailabilityText(text: string, opts: { today: DateString; defaultMonth?: string }): AvailabilityParse {
  const defaultMonth = opts.defaultMonth ?? nextMonth(monthOf(opts.today));
  const explicit = nfkc(text).match(/(?<!\d)(\d{1,2})月/);
  let month = defaultMonth;
  if (explicit) {
    const d = resolveMonthDay(Number(explicit[1]), 1, opts.today);
    if (d) month = monthOf(d);
  }
  const monthFromMd = (m: number): string | null => {
    const d = resolveMonthDay(m, 1, opts.today);
    return d ? monthOf(d) : null;
  };
  const assigned = new Map<string, AvailabilityStatus>();
  const unread: string[] = [];
  const dateOf = (m: string, day: number): DateString | null => {
    const d = `${m}-${String(day).padStart(2, "0")}`;
    return isDateString(d) ? (d as DateString) : null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = nfkc(rawLine).replace(/[（(][^()（）]*[)）]/g, " ").trim();
    if (!line) continue;
    // 1行をトークンに分ける: 日付（11/1・1日・1〜5・1-5・1）、印、ほか
    const tokens: ({ t: "date"; dates: DateString[] } | { t: "mark"; status: AvailabilityStatus } | { t: "all" } | { t: "rest" })[] = [];
    const re = /(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*[〜~\-]\s*(?:(\d{1,2})\s*\/\s*)?(\d{1,2}))?日?|(\d{1,2})日?\s*[〜~\-]\s*(\d{1,2})日?|(\d{1,2})日|(?<![\d/:A-Za-z])(\d{1,2})(?![\d/:A-Za-z時分人名件円台月])|全部|全日|すべて|全て|ほか|他|それ以外|残り|以外|[○◯〇⭕️⭕△▲🔺×✕✖❌✗]|OK|ok|Ok|NG|ng|Ng|不可|無理|休み|可|参加|行けます|いけます|行けません|いけません|空いてます|空いています|大丈夫|たぶん|多分|調整|要相談|未定|午前|午後|AM|PM|am|pm|ダメ|だめ/gu;
    let m: RegExpExecArray | null;
    let lineMonth = month;
    while ((m = re.exec(line))) {
      const s = m[0];
      if (m[1] && m[2]) {
        const mm = monthFromMd(Number(m[1]));
        if (!mm) continue;
        lineMonth = mm;
        const endMonth = m[3] ? (monthFromMd(Number(m[3])) ?? mm) : mm;
        const from = dateOf(mm, Number(m[2]));
        const to = m[4] ? dateOf(endMonth, Number(m[4])) : from;
        if (from && to) tokens.push({ t: "date", dates: range(from, to) });
      } else if (m[5] && m[6]) {
        const from = dateOf(lineMonth, Number(m[5]));
        const to = dateOf(lineMonth, Number(m[6]));
        if (from && to) tokens.push({ t: "date", dates: range(from, to) });
      } else if (m[7] || m[8]) {
        const d = dateOf(lineMonth, Number(m[7] ?? m[8]));
        if (d) tokens.push({ t: "date", dates: [d] });
      } else if (/^(全部|全日|すべて|全て)$/.test(s)) tokens.push({ t: "all" });
      else if (/^(ほか|他|それ以外|残り|以外)$/.test(s)) tokens.push({ t: "rest" });
      else {
        const st = markOf(s);
        if (st) tokens.push({ t: "mark", status: st });
      }
    }
    if (!tokens.length) continue;
    const hasDate = tokens.some((t) => t.t !== "mark");
    const hasMark = tokens.some((t) => t.t === "mark");
    if (!hasDate || !hasMark) {
      if (hasDate || hasMark) unread.push(rawLine.trim());
      continue;
    }
    const all = Array.from({ length: daysInMonth(lineMonth) }, (_, i) => dateOf(lineMonth, i + 1)!);
    const put = (dates: DateString[], status: AvailabilityStatus) => dates.forEach((d) => assigned.set(d, status));
    const expand = (t: (typeof tokens)[number]): DateString[] => (t.t === "date" ? t.dates : t.t === "all" ? all : t.t === "rest" ? all.filter((d) => !assigned.has(d)) : []);
    // 行が印で始まるなら「印 → 日付」、そうでなければ「日付 → 印」
    if (tokens[0].t === "mark") {
      let cur: AvailabilityStatus | null = null;
      for (const t of tokens) {
        if (t.t === "mark") cur = t.status;
        else if (cur) put(expand(t), cur);
      }
    } else {
      let pending: DateString[] = [];
      for (const t of tokens) {
        if (t.t === "mark") {
          put(pending, t.status);
          pending = [];
        } else pending.push(...expand(t));
      }
      if (pending.length) unread.push(rawLine.trim());
    }
  }
  const days = [...assigned.entries()].map(([date, status]) => ({ date: date as DateString, status })).sort((a, b) => a.date.localeCompare(b.date));
  return { month, days, unread };
}

function range(from: DateString, to: DateString): DateString[] {
  const out: DateString[] = [];
  for (let d = from, i = 0; d <= to && i < 62; d = addDays(d, 1), i++) out.push(d);
  return out;
}

/**
 * 報告の文の所感（「所感: 〇〇」「【所感】」から下、または「コメント:」「一言:」）。いつもの書き方の報告（readReport）は所感を持たないので、ここで拾う
 */
export function extractComment(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const i = lines.findIndex((l) => /^\s*(?:[【\[［]\s*)?(所感|感想|コメント|備考|メモ|一言)\s*(?:[】\]］])?\s*[:：]?\s*/.test(l.normalize("NFKC")));
  if (i < 0) return "";
  const first = lines[i].normalize("NFKC").replace(/^\s*(?:[【\[［]\s*)?(所感|感想|コメント|備考|メモ|一言)\s*(?:[】\]］])?\s*[:：]?\s*/, "");
  const rest = lines.slice(i + 1);
  // 次の見出し（【〇〇】）までを所感にする
  const end = rest.findIndex((l) => /^\s*[【\[［]/.test(l));
  return [first, ...(end < 0 ? rest : rest.slice(0, end))].join("\n").trim().slice(0, 1000);
}

const POSITIVE = /参加(でき|出来|します|可能|OK|します)|行けます|いけます|大丈夫です|お願いします|OKです|オッケー|了解|よろしくお願い|入れます|出れます|出られます/;
const NEGATIVE = /行けません|いけません|無理|難しい|できません|出来ません|辞退|NGです|見送|入れません|出れません|出られません/;

/** 打診の返事（短い文）か */
export function detectReply(text: string): { positive: boolean } | null {
  const t = nfkc(text).trim();
  if (!t || t.length > 80 || t.split("\n").length > 4) return null;
  if (NEGATIVE.test(t)) return { positive: false };
  if (POSITIVE.test(t)) return { positive: true };
  return null;
}

/**
 * 貼られた文を見分ける。dict（取引先の項目・言いかえ表）は報告の読み取りに使う（なくてもよい）。
 */
export function classifyPaste(text: string, opts: { today: DateString; roleNames: string[]; dict?: NameDict; person?: (name: string) => string | null; defaultMonth?: string }): Classified {
  const t = text.replace(/\r/g, "").trim();
  if (!t) return { kind: "unknown" };
  const msg = { date: opts.today, time: "12:00", sender: "", text: t };

  const detail = readDetailPost(msg, 0);
  if (detail) return { kind: "details", detail };

  const recruit = parseRecruitText(t, { today: opts.today, roleNames: opts.roleNames });
  if (recruit.dates.length >= 1 && (recruit.venue || recruit.roles.length) && !/[○◯〇⭕△▲🔺×✕✖❌]/u.test(t)) return { kind: "recruit", recruit };

  const nicoly = parseReportText(t, opts.dict);
  const line = readReport(msg, 0, { person: opts.person });
  const nicolyLines = nicoly.lines.filter((l) => l.count > 0).length;
  const lineLines = line?.lines.length ?? 0;
  if (nicolyLines > 0 || lineLines > 0 || line?.zero) return { kind: "report", nicoly: nicolyLines > 0 ? nicoly : null, line: lineLines > 0 || line?.zero ? line : null };

  // 短い返事（「参加できます」）は、日付（11/3・3日）が書いてなければ稼働可能日より先に返事とみなす
  const reply = detectReply(t);
  const explicitDate = /\d{1,2}\s*\/\s*\d{1,2}|\d{1,2}日/.test(nfkc(t));
  if (reply && !explicitDate) return { kind: "reply", positive: reply.positive };

  const availability = parseAvailabilityText(t, { today: opts.today, defaultMonth: opts.defaultMonth });
  if (availability.days.length) return { kind: "availability", availability };
  if (reply) return { kind: "reply", positive: reply.positive };

  return { kind: "unknown" };
}
