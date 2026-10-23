/**
 * 案件まわりの LINE の文を読む（Phase 21。DB を使わない）。
 *
 * 1. 案件の文（取引先から）: 「20 〇〇外販　1名」「21,22 △△軒先 2名」のような行が並び、単価・稼働時間・備考が続く
 * 2. 面談候補日の返事（本人から）: 「10/26 20:00〜」「10月27日(火)15時以降」「10/28 終日」
 * 3. 合否の連絡（取引先から）: 「〇〇さん合格です」「△△は不合格」「合格: A、B」
 * 4. 人員変更の文（取引先から）: 「10月30日の〇〇 △△欠員のため人員変更。□□ Aと B / 〇〇 C」
 * 読むだけで、CRM の人・会場への当てはめと登録はサーバー側（inbox/actions・proposals）で行う。金額は単価だけ（オーナーだけが使う）。
 */
import { type DateString, monthOf, nextMonth, resolveMonthDay } from "@/lib/date";

const nfkc = (s: string) => s.normalize("NFKC");
const lines = (text: string) => text.replace(/\r/g, "").split("\n").map((l) => nfkc(l).replace(/[ \t　]+/g, " ").trim());

// ---------------------------------------------------------------------------
// 1. 案件の文
// ---------------------------------------------------------------------------

export type JobOfferLine = { date: DateString; day: number; venue: string; count: number };

export type JobOfferParse = {
  /** 日程の行（日付順。同じ日・同じ会場は人数の大きいほう） */
  lines: JobOfferLine[];
  /** 文から分かった月（YYYY-MM）。「11月」と書いてなければ、日付が今日以降になる月 */
  month: string | null;
  /** 請求の人日単価（円）。「単価 22000円/日」。なければ null */
  rate: number | null;
  transportIncluded: boolean;
  /** 稼働時間（最初の1つ。HH:MM） */
  start: string | null;
  end: string | null;
  /** 稼働時間の書き方そのまま（「10:00〜18:00 or 11:00〜19:00」） */
  hoursNote: string;
  /** 備考（「備考」の見出しから下） */
  notes: string;
};

// 「20 〇〇外販 1名」「21,22 △△軒先 2名」「7日〇〇」は人数がないので日程の行にしない（人数のある行だけ）
const OFFER_LINE = /^(\d{1,2}(?:\s*[,、，・]\s*\d{1,2})*)\s*日?\s*(\S.*?)\s*(\d{1,3})\s*名\s*$/;
const TIME_RANGE = /(\d{1,2}):(\d{2})\s*[〜~～\-－]\s*(\d{1,2}):(\d{2})/g;
const pad = (n: number | string) => String(n).padStart(2, "0");

export function parseJobOffer(text: string, today: DateString): JobOfferParse {
  const ls = lines(text);
  const headerMonth = ls.slice(0, 5).map((l) => l.match(/^(\d{1,2})月/)).find(Boolean)?.[1];
  const raw: { days: number[]; venue: string; count: number }[] = [];
  let rate: number | null = null;
  let transportIncluded = false;
  let hoursNote = "";
  let start: string | null = null;
  let end: string | null = null;
  const notes: string[] = [];
  let section: "lines" | "hours" | "notes" | null = "lines";

  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    if (!l) {
      if (section === "notes") notes.push("");
      continue;
    }
    if (/^単価/.test(l) || /^\d[\d,]{3,}\s*円/.test(l)) {
      const m = (l + " " + (ls[i + 1] ?? "")).match(/(\d[\d,]{2,})\s*円/);
      if (m) rate = Number(m[1].replace(/,/g, ""));
      if (/交通費込/.test(l + (ls[i + 1] ?? ""))) transportIncluded = true;
      section = null;
      continue;
    }
    if (/^稼働時間/.test(l)) {
      section = "hours";
      const rest = l.replace(/^稼働時間\s*[:：]?\s*/, "");
      if (rest) ls.splice(i + 1, 0, rest);
      continue;
    }
    if (/^(備考|注意|条件)/.test(l)) {
      section = "notes";
      const rest = l.replace(/^(備考|注意|条件)\s*[:：]?\s*/, "");
      if (rest) notes.push(rest);
      continue;
    }
    if (section === "hours") {
      const ranges = [...l.matchAll(TIME_RANGE)].map((m) => `${pad(m[1])}:${m[2]}〜${pad(m[3])}:${m[4]}`);
      if (ranges.length) {
        hoursNote = [hoursNote, ...ranges].filter(Boolean).join(" or ");
        if (!start) {
          start = ranges[0].slice(0, 5);
          end = ranges[0].slice(6, 11);
        }
        continue;
      }
      if (/^or$/i.test(l)) continue;
      section = null;
    }
    if (section === "notes") {
      notes.push(l);
      continue;
    }
    const m = l.match(OFFER_LINE);
    if (m) {
      const days = m[1].split(/[,、，・]/).map((d) => Number(d.trim())).filter((d) => d >= 1 && d <= 31);
      if (days.length) raw.push({ days, venue: m[2].replace(/[　\s]+$/, ""), count: Number(m[3]) });
      section = "lines";
    }
  }

  // 月: 書いてあればそれ。なければ、日が全部「今日の日」以降なら今月、そうでなければ来月
  const todayDay = Number(today.slice(8, 10));
  const allDays = raw.flatMap((r) => r.days);
  const month = headerMonth ? null : allDays.length ? (Math.min(...allDays) >= todayDay ? monthOf(today) : nextMonth(monthOf(today))) : null;
  const dateOf = (day: number): DateString | null => {
    if (headerMonth) return resolveMonthDay(Number(headerMonth), day, today);
    if (!month) return null;
    const d = `${month}-${pad(day)}`;
    const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
    return day <= last ? (d as DateString) : null;
  };
  const byKey = new Map<string, JobOfferLine>();
  for (const r of raw) {
    for (const day of r.days) {
      const date = dateOf(day);
      if (!date) continue;
      const k = `${date}|${r.venue}`;
      const cur = byKey.get(k);
      if (!cur || cur.count < r.count) byKey.set(k, { date, day, venue: r.venue, count: r.count });
    }
  }
  const out = [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue, "ja"));
  const resolvedMonth = out.length ? out[0].date.slice(0, 7) : (month ?? null);
  return {
    lines: out,
    month: resolvedMonth,
    rate,
    transportIncluded,
    start,
    end,
    hoursNote,
    notes: notes.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

/** 案件の文らしいか（日程の行が2つ以上、または日程の行があって単価・稼働時間の見出しがある） */
export function looksLikeJobOffer(p: JobOfferParse, text: string): boolean {
  if (p.lines.length >= 2) return true;
  return p.lines.length >= 1 && /単価|稼働時間/.test(nfkc(text));
}

// ---------------------------------------------------------------------------
// 2. 面談候補日の返事
// ---------------------------------------------------------------------------

export type InterviewSlot = { date: DateString; text: string };

const SLOT_LINE = /^(?:(\d{1,2})\s*[/月]\s*)?(\d{1,2})日?\s*(?:\([^)]*\))?\s*(.*)$/;
const SLOT_REST = /(\d{1,2}(?::\d{2})?\s*時?(?:\s*(?:半|\d{2}分))?\s*(?:[〜~～\-－]|以降|から|まで|スタート|開始)?|終日|全日|全日程|いつでも|OK|ok)/;

/**
 * 本人からの面談の候補日時を読む。「10/26 20:00〜」「10/27 9:00〜12:00」「10月27日(火)15時以降」「10/28 終日」。
 * 月を省いた行（「27 15時以降」）は前の行の月を引きつぐ
 */
export function parseInterviewSlots(text: string, today: DateString): { slots: InterviewSlot[] } {
  const out: InterviewSlot[] = [];
  let month: number | null = null;
  for (const l of lines(text)) {
    if (!l) continue;
    const m = l.match(SLOT_LINE);
    if (!m) continue;
    const mm: number | null = m[1] ? Number(m[1]) : month;
    const rest = m[3].trim();
    if (!mm || !SLOT_REST.test(rest)) continue;
    const date = resolveMonthDay(mm, Number(m[2]), today);
    if (!date) continue;
    month = mm;
    out.push({ date, text: `${mm}/${Number(m[2])} ${rest.replace(/\s+/g, " ")}`.trim() });
  }
  return { slots: out };
}

// ---------------------------------------------------------------------------
// 3. 合否の連絡
// ---------------------------------------------------------------------------

export type ScreeningResult = { name: string; passed: boolean };

const PASS = /合格|採用|通過|OK/;
const FAIL = /不合格|不採用|見送り|見送る|NG|落ち/;
const STRIP = /(さん|様|君|くん|ちゃん|氏)$/;
const NOISE = /^(は|が|の|と|も|で|です|でした|になりました|とのこと|こと|結果|面談|の方|方|お疲れ様です|お世話になっております|よろしくお願いします|お願いします|ありがとうございます|連絡|ご連絡|です。|でした。)$/;

const KEYWORDS = /(不合格|不採用|見送り|見送る|合格|採用|通過|OK|NG|落ち)/g;

const cleanName = (t: string) => t.replace(/(は|が|も|の|と)$/, "").replace(STRIP, "").trim();
const isName = (t: string) => Boolean(t) && !NOISE.test(t) && !/^\d/.test(t) && t.length <= 12 && /[一-龠々ぁ-んァ-ヶA-Za-z]/.test(t) && !PASS.test(t) && !FAIL.test(t);

/** 名前の候補。「、・/」で分け、「試験 花子」のように空白で2つに分かれる短い語はひとりの名前として残す */
function namesIn(fragment: string): string[] {
  const out: string[] = [];
  // 「検証さんと試験さん」の「と」も区切り（敬称のあとの「と」だけ。「山と田」のような名前は切らない）
  for (const piece of fragment.replace(/[「」『』【】()（）]/g, " ").split(/[、,，・/／:：→]+|(?<=さん|様|君|くん|ちゃん)と/)) {
    const tokens = piece.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 2 && tokens.every((t) => t.length <= 4 && /^[一-龠々ぁ-んァ-ヶA-Za-z]+(さん|様|君|くん)?$/.test(t))) {
      const name = `${cleanName(tokens[0])} ${cleanName(tokens[1])}`.trim();
      if (isName(name.replace(" ", ""))) out.push(name);
      continue;
    }
    for (const t of tokens) {
      const name = cleanName(t);
      if (isName(name)) out.push(name);
    }
  }
  return out;
}

/**
 * 「〇〇さん合格です」「〇〇は不合格でした」「合格: A、B / 不合格: C」を読む。
 * 名前が結果の行にないときは、すぐ前の行の名前を使う（「須田凌平\n合格です」のような書き方）
 */
export function parseScreeningResult(text: string): { results: ScreeningResult[] } {
  const results: ScreeningResult[] = [];
  const seen = new Set<string>();
  let prevNames: string[] = [];
  for (const l of lines(text)) {
    if (!l) continue;
    // 1行に「合格」と「不合格」の両方があるときは、句読点で分けて別々に見る
    const parts = l.split(/[。．]|、(?=[^、]*(?:合格|不合格|採用|不採用|見送))/).map((p) => p.trim()).filter(Boolean);
    let hit = false;
    for (const part of parts) {
      const failed = FAIL.test(part);
      const passed = !failed && PASS.test(part);
      if (!failed && !passed) continue;
      hit = true;
      // 「合格: A、B」の見出し形 → 「Aさんは合格です」の文末形 → 残った言葉 の順に結果の言葉を外して、名前だけにする
      const body = part
        .replace(/^(不合格|不採用|見送り|合格|採用|通過)(者|の方|の人)?\s*[:：は→]?\s*/, " ")
        .replace(/(は|が|も|、)?\s*(不合格|不採用|見送り|見送る|合格|採用|通過|OK|NG|落ち)\s*(です|でした|になりました|となりました|とのことです|とのこと|のこと|！|!|。)*\s*$/u, " ")
        .replace(KEYWORDS, " ");
      let names = namesIn(body);
      if (!names.length) names = prevNames;
      for (const name of names) {
        if (seen.has(name)) continue;
        seen.add(name);
        results.push({ name, passed: !failed });
      }
    }
    if (!hit) prevNames = namesIn(l);
    else prevNames = [];
  }
  return { results };
}

// ---------------------------------------------------------------------------
// 4. 人員変更の文
// ---------------------------------------------------------------------------

export type ReassignParse = {
  date: DateString | null;
  /** 欠員が出た会場と人（「〇〇 △△欠員のため」） */
  outVenue: string;
  outNames: string[];
  /** 新しい割り当て（会場 → 人） */
  lines: { venue: string; names: string[] }[];
};

const SPLIT_NAMES = /[と・、,，&＆\s/／]+/;

/**
 * 「10月30日の〇〇 △△欠員のため人員変更。\n□□ A と B\n〇〇 C」を読む。
 * 1行目: 日付・欠員の会場・人。2行目以降: 「会場 名前（と・、で区切り）」
 */
export function parseReassignment(text: string, today: DateString): ReassignParse | null {
  const ls = lines(text).filter(Boolean);
  if (!ls.length || !/人員変更|欠員|入れ替え|変更/.test(ls.join("\n")) || !/欠員|人員変更|入れ替え/.test(ls.join("\n"))) return null;
  const head = ls[0];
  const md = head.match(/(\d{1,2})\s*[/月]\s*(\d{1,2})日?/);
  const date = md ? resolveMonthDay(Number(md[1]), Number(md[2]), today) : null;
  let outVenue = "";
  let outNames: string[] = [];
  const out = head.match(/(?:日\s*(?:\([^)]*\))?\s*の?\s*)?(\S+)\s+(\S+?)\s*(?:が|は|の)?\s*(?:欠員|不参加|キャンセル|辞退)/);
  if (out) {
    outVenue = out[1].replace(/^.*日の?/, "");
    outNames = out[2].split(SPLIT_NAMES).map((n) => n.replace(STRIP, "")).filter(Boolean);
  }
  const rows: ReassignParse["lines"] = [];
  for (const l of ls.slice(1)) {
    if (/欠員|人員変更|よろしく|お願い/.test(l)) continue;
    const m = l.match(/^(\S+)\s+(.+)$/);
    if (!m) continue;
    const names = m[2].split(SPLIT_NAMES).map((n) => n.replace(STRIP, "").trim()).filter((n) => n && !NOISE.test(n));
    if (names.length) rows.push({ venue: m[1], names });
  }
  if (!rows.length && !outNames.length) return null;
  return { date, outVenue, outNames, lines: rows };
}
