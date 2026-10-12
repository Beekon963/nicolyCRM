/**
 * LINE のトーク履歴（「トーク履歴を保存」の .txt）から、過去の件数の報告と現場詳細を読み取る（Phase 11）。
 *
 * - 件数の報告: 日付・会場・稼働した人・「当日」の獲得件数。見込み・予約・戻り予定の下は数えない
 * - 2人以上で取った件数は人数で割る（「PI1（A、B）」は0.5件ずつ。名前が並んだ報告で項目に名前がなければ、並んだ人数で割る）
 * - お客様のお名前（〇〇様）・予約の日時・乗り換えの行（→）は件数にもメモにも使わない
 * - 現場詳細（【案件詳細】集合場所・持ち物・服装）は、会場のメモに入れるために本文を取っておく
 *
 * 読み取りはブラウザの中だけで行い、サーバーには取り込む件数だけを送る（トーク履歴そのものは保存しない）
 */
import { splitCount } from "@/lib/count";
import { addDays, isDateString, parse as parseDate, resolveMonthDay } from "@/lib/date";
import { type ParsedLine, parseItemLine } from "@/lib/report-convert";

export type LineMessage = { date: string; time: string; sender: string; text: string };

export type LineShare = { person: string; count: number };

export type LineReportLine = {
  /** 項目の書き方（例: ゴールドカード・PI） */
  raw: string;
  /** 書いてあった件数 */
  count: number;
  /** だれの分か（人数で割ったあと） */
  shares: LineShare[];
  /** 件数のある行の下にあった、件数のない行（「PI1」の下の「D払い初回利用」など）。取り込む画面で項目を選んだときだけ数える */
  sub: boolean;
};

export type LineReport = {
  /** トーク履歴の中の何番目のメッセージか */
  index: number;
  date: string;
  /** 送った時刻（画面で見分けるため） */
  time: string;
  sender: string;
  venue: string;
  /** 稼働した人（書いてあった名前。なければ送った人） */
  people: string[];
  lines: LineReportLine[];
  /** 「件数0」「PI0件」のように、稼働したが獲得なし */
  zero: boolean;
};

export type LineDetailPost = { index: number; date: string; sender: string; venue: string; body: string };

export type LineHistory = { title: string; messages: LineMessage[]; reports: LineReport[]; details: LineDetailPost[] };

const INVISIBLE = /[⁦-⁩​-‏﻿]/g;
const DATE_LINE = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})(?:\s*\(.\)|\s+.曜日)?\s*$/;
const MSG_LINE = /^(\d{1,2}:\d{2})\t([^\t]*)\t?(.*)$/;

/** トーク履歴の .txt をメッセージに分ける（複数行のメッセージは " で囲まれている） */
export function splitMessages(text: string): { title: string; messages: LineMessage[] } {
  const lines = text.replace(INVISIBLE, "").split(/\r?\n/);
  const title = (lines[0] ?? "").replace(/^\[LINE\]\s*/, "").replace(/のトーク履歴$/, "").trim();
  const messages: LineMessage[] = [];
  let date = "";
  let cur: LineMessage | null = null;
  for (const line of lines.slice(1)) {
    const d = line.match(DATE_LINE);
    if (d) {
      const iso = `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}`;
      if (isDateString(iso)) {
        date = iso;
        cur = null;
        continue;
      }
    }
    const m = date ? line.match(MSG_LINE) : null;
    if (m) {
      cur = { date, time: m[1].padStart(5, "0"), sender: m[2].trim(), text: m[3] };
      messages.push(cur);
      continue;
    }
    if (cur) cur.text += `\n${line}`;
  }
  for (const m of messages) {
    let t = m.text.replace(/\s+$/, "");
    if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) t = t.slice(1, -1).replace(/""/g, '"');
    m.text = t;
  }
  return { title, messages };
}

// ---------------------------------------------------------------------------
// 件数の報告を読む
// ---------------------------------------------------------------------------

/** 数えない見出し（まだ獲得していない・お店全体の数・累計・感想） */
const SKIP_HEAD = /^[【\[［(（・●■◆▼\s]*(見込|予約|戻り|予定|後日予定|次回|明日|全体実績|店舗実績|店舗全体|累計|所感|感想|反省|備考|目標)/;
/** 数える見出し（当日の獲得） */
const COUNT_HEAD = /^[【\[［・●■◆▼\s]*(当日|実績|成約|獲得|本日|既存)/;
/** 乗り換えの説明（「ソフトバンクからahamo」） */
const SWITCH = /(ドコモ|docomo|au|uq|ソフトバンク|sb|ワイモバ\S*|y!?mobile|ym|楽天\S*|ahamo|povo|linemo|他社|mvno)\s*から/i;
/** お客様のお名前・予約の日時・乗り換えの説明（件数にもメモにも使わない） */
const PRIVATE = /様|→|⇒|〜\s*$|\d{1,2}[:：]\d{2}|\d{1,2}時/;
/** 稼働の様子の数（獲得ではない） */
export const ACTIVITY_WORDS = /^(応対|応対数|商談|商談数|声かけ|声掛け|キャッチ|来店|来店数|接客|接客数|アンケート|案内|案内数|トス|トスアップ)/;
/** 合計の行（上の行と二重になる） */
const TOTAL_WORDS = /^(合計|全体|総計|計|トータル|total)/i;
/** 会場らしい言葉 */
const VENUE_WORD = /(ショップ|DS|ＤＳ|ドコモ|docomo|店|モール|ガーデン|イオン|コーナン|ららぽーと|アリオ|ヨーカドー|駅|外販|軒先|催事|ビック|ヤマダ|ケーズ|エディオン|ノジマ|ドンキ|カインズ|ジョイフル|プラザ|タウン|センター|パーク|ヒルズ|ワールド|会場|ホール|イベント|テレアポ)/i;
/** 会場ではない言葉（「ドコモユーザー」は見出し） */
const NOT_VENUE = /ユーザー|お客|様/;
/** 文（あいさつ・連絡・感想）。日付・会場・名前の行ではない */
const SENTENCE = /[。！!？?]|です|ます|ました|ください|お願い|でした/;
const ZERO = /(件数|PI|ＰＩ|当日|獲得)\s*[:：]?\s*0\s*件?|0件/i;
const DATE_HEAD = /^\s*(?:(\d{4})[/年.-])?(\d{1,2})\s*[/月.-]\s*(\d{1,2})日?\s*(?:[（(][^)）]*[)）])?\s*/;
/** 「日付：」「稼働店舗名：」「名前：」のような見出し */
const DATE_LABEL = /^(日付|日にち|日時|稼働日)\s*[:：]?\s*/;
const VENUE_LABEL = /^(稼働店舗名?|店舗名?|会場名?|現場名?|稼働場所|開催場所|場所|勤務地)\s*[:：]\s*/;
/** 見出しだけの行（「● 店舗」の次の行が会場）。開催場所は店舗より細かいので、あればそちらを使う */
const VENUE_LABEL_ONLY = /^(稼働店舗名?|店舗名?|会場名?|現場名?|稼働場所|開催場所|場所|勤務地)\s*[:：]?$/;
const NAME_LABEL_ONLY = /^(名前|氏名|稼働者|担当者?|スタッフ|メンバー)\s*[:：]?$/;
const NAME_LABEL = /^(名前|氏名|稼働者|担当者?|スタッフ|メンバー)\s*[:：]\s*/;
/** 名前のあとに付いた役目（「山田ダブクロ」「佐藤戻り」） */
const ROLE_WORD = /(ダブクロ|キャッチ|クロージング|クローザー|ヘルプ|ヘルパー|戻り|担当|紹介|さん|くん|ちゃん)$/;
/** 機種の名前の数字（「iPhone16」「Galaxy A25」は件数ではない） */
const MODEL = /(iphone|galaxy(\s*[a-z])?|pixel|xperia|aquos|arrows|ipad)$/i;

export type ReadOptions = {
  /**
   * 名前に合うスタッフ（画面ではスタッフの一覧から当てる）。合わなければ null。
   * あると「会場 名前 名前」の行を会場と人に分けられる。ないときは並びと言葉から推し量る
   */
  person?: (name: string) => string | null;
};

function stripName(s: string): string {
  let t = s.replace(/^[\s　]+|[\s　]+$/g, "");
  for (let i = 0; i < 3 && ROLE_WORD.test(t) && t.replace(ROLE_WORD, "").length >= 1; i++) t = t.replace(ROLE_WORD, "").trim();
  return t;
}
const ROLE_ONLY = new RegExp(`^${ROLE_WORD.source.slice(0, -1)}$`);

/** 名前の並び（「山田、佐藤、鈴木」「中村,小川」） */
function splitPeople(s: string): string[] {
  return s
    .split(/[、,，・／/]|\s{2,}/)
    .map(stripName)
    .filter((x) => x && x.length <= 12 && !/\d/.test(x));
}

/**
 * 名前の分かる行を、人と、それ以外（会場）に分ける（スタッフの一覧で当てる）。
 * 同じ人に当たった続きの言葉（「山田 太郎」）は1人。最初の人より後ろの、会場らしくない言葉は分からない人として残す
 */
function sortTokens(s: string, person: (name: string) => string | null): { people: string[]; place: string[] } {
  const whole = stripName(s.replace(/[\s　]+/g, " "));
  if (!/[、,，・／/（）()]/.test(whole) && person(whole)) return { people: [whole], place: [] };
  const people: string[] = [];
  const place: string[] = [];
  let last: string | null = null;
  // かっこの中は、だれか分かる名前だけ使う（「山田（通称ヤマちゃん）」のあだ名は外す）
  for (const [, inParen, plain] of s.matchAll(/[（(]([^（）()]*)[)）]|([^（）()]+)/g)) {
    for (const t0 of (inParen ?? plain).split(/[、,，・／/\s　]+/)) {
      const t = stripName(t0);
      if (!t || ROLE_ONLY.test(t)) continue;
      const id = /\d/.test(t) ? null : person(t);
      if (id) {
        if (id === last) people[people.length - 1] += ` ${t}`;
        else people.push(t);
        last = id;
        continue;
      }
      last = null;
      if (inParen != null && people.length) continue;
      if (people.length && !VENUE_WORD.test(t) && t.length <= 12 && !/\d/.test(t)) people.push(t);
      else place.push(t);
    }
  }
  return { people, place };
}

/** 本文の最初の日付（「7月24日」「8/9」「2026/09/12」）。年がなければ送った日に近い日 */
function textDate(line: string, sentOn: string): string | null {
  const m = line.normalize("NFKC").match(DATE_HEAD);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (m[1]) {
    const iso = `${m[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return isDateString(iso) ? iso : null;
  }
  // 送った日の前後で一番近い年（12月の報告を1月に送ったときなど）
  const { y } = parseDate(sentOn);
  const candidates = [y - 1, y, y + 1]
    .map((yy) => `${yy}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`)
    .filter(isDateString);
  if (!candidates.length) return resolveMonthDay(month, day, sentOn);
  const dist = (d: string) => Math.abs(Date.parse(d) - Date.parse(sentOn));
  return candidates.sort((a, b) => dist(a) - dist(b))[0];
}

const clean = (l: string) =>
  l
    .replace(/^[\s　・●■◆▼-]+/, "")
    .replace(/[\s　]+$/, "")
    .trim();

/** 件数の行。「mnp1、電気1（山田）」のように、で区切った全部に件数があれば別々の項目（最後の（名前）は全部にかかる） */
function parseItems(body: string): ParsedLine[] {
  const one = parseItemLine(body);
  const tail = body.match(/^(.*?)\s*[（(]([^（）()]+)[)）]\s*$/);
  const parts = (tail ? tail[1] : body)
    .split(/[、，,]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const each = parts.map((p) => parseItemLine(p));
    if (each.every((p) => p && p.count > 0 && !p.person)) return each.map((p) => ({ ...p!, ...(tail ? { person: tail[2] } : {}) }));
  }
  return one ? [one] : [];
}

/** 件数として使わない行か（機種の名前の数字・電話番号のような大きな数） */
function notACount(p: ParsedLine, body: string): boolean {
  if (p.count >= 100) return true;
  return p.count >= 5 && MODEL.test(p.raw.normalize("NFKC").trim()) && !/\d\s*(件|台)/.test(body);
}

/** 1つのメッセージを件数の報告として読む。報告でなければ null */
export function readReport(msg: LineMessage, index: number, opts: ReadOptions = {}): LineReport | null {
  const text = msg.text;
  if (!text.trim() || text.includes("━") || text.length > 3000) return null;
  const raw = text.split("\n");
  // 0時台・早朝に送った日付のない報告は、前の日の分とみなす
  let date = Number(msg.time.slice(0, 2)) < 5 ? addDays(msg.date, -1) : msg.date;
  let venue = "";
  let people: string[] = [];
  const lines: LineReportLine[] = [];
  let section: "count" | "skip" = "count";
  let started = false;
  let parent: LineReportLine | null = null;
  let zero = false;
  let headerSeen = 0;

  const assign = (count: number, tag: string[] | null): LineShare[] => {
    const who = tag?.length ? tag : people.length ? people : [msg.sender];
    return splitCount(count, who.length).map((c, i) => ({ person: who[i], count: c }));
  };
  /** （名前）の中の人 */
  const tagPeople = (s: string): string[] => {
    if (!opts.person) return splitPeople(s);
    const { people: ps, place } = sortTokens(s, opts.person);
    // 分からない名前（他社のヘルパーなど）も1人として数える（その人の分は取り込まない）
    return [...ps, ...place.filter((t) => t.length <= 12 && !/\d/.test(t))];
  };
  const addPeople = (ps: string[]) => {
    for (const p of ps) if (!people.includes(p)) people.push(p);
  };
  /** 見出しより前の、日付のない行（会場・名前） */
  let nextIs: "venue" | "place" | "name" | null = null;
  const header = (text: string) => {
    const t = text.trim();
    const was = nextIs;
    nextIs = null;
    if (!t || t.startsWith("@") || SENTENCE.test(t) || t.length > 40) return;
    const only = t.match(VENUE_LABEL_ONLY);
    if (only) return void (nextIs = only[1] === "開催場所" ? "place" : "venue");
    if (NAME_LABEL_ONLY.test(t)) return void (nextIs = "name");
    if (was === "place" || (was === "venue" && !venue)) return void (venue = t);
    if (was === "name") return addPeople(tagPeople(t));
    const vl = t.match(VENUE_LABEL);
    if (vl) {
      if (!venue || vl[1] === "開催場所") venue = t.slice(vl[0].length).trim();
      return;
    }
    const nl = t.match(NAME_LABEL);
    if (nl) return addPeople(tagPeople(t.slice(nl[0].length)));
    if (opts.person) {
      const { people: ps, place } = sortTokens(t, opts.person);
      if (ps.length) {
        addPeople(ps);
        if (place.length && !venue) venue = place.join(" ");
      } else if (!venue && !NOT_VENUE.test(t)) venue = t;
      return;
    }
    // スタッフの一覧がないとき: 会場らしい言葉があれば会場、名前の並び（、区切り）や2行目は人
    if (!venue && !NOT_VENUE.test(t) && (VENUE_WORD.test(t) || (people.length > 0 && !/[、,，]/.test(t)))) venue = t;
    else if (!people.length) people = splitPeople(t);
    else if (!venue) venue = t;
  };

  for (const line0 of raw) {
    const line = clean(line0);
    if (!line) {
      parent = null;
      continue;
    }
    const n = line.normalize("NFKC");
    if (ZERO.test(n) && !/[1-9]/.test(n.replace(/\d{1,2}[/月]\d{1,2}/, ""))) zero = true;

    // 見出し（当日・見込み など）。「【当日】　PI6」のように同じ行に件数があれば続けて読む
    const skip = SKIP_HEAD.test(n);
    const count = !skip && COUNT_HEAD.test(n);
    let body = line;
    if (skip || count) {
      section = skip ? "skip" : "count";
      started = true;
      parent = null;
      body = line.replace(/^[【\[［・●■◆▼\s]*(見込み?|予約|戻り予定|戻り|予定|後日予定|次回|明日|当日|実績|成約|獲得|本日|既存ユーザー|既存)(?:[^】\]］]*[】\]］])?[\s:：・]*/, "").trim();
      if (!body || section === "skip") continue;
    }
    if (section === "skip") continue;

    // 見出しより前: 日付・会場・名前
    if (!started && headerSeen < 5) {
      const dl = body.replace(DATE_LABEL, "");
      const d = textDate(dl, msg.date);
      if (d && /^\s*(\d{4}[/年.-])?\d{1,2}\s*[/月.-]\s*\d{1,2}/.test(dl.normalize("NFKC"))) {
        date = d;
        headerSeen++;
        header(dl.normalize("NFKC").replace(DATE_HEAD, "").trim());
        continue;
      }
      if (!parseItems(body).length && !PRIVATE.test(body)) {
        headerSeen++;
        header(body);
        continue;
      }
    }

    if ((PRIVATE.test(body) || SWITCH.test(body.normalize("NFKC"))) && !/^(PI|ＰＩ)/i.test(body)) continue;
    const items = parseItems(body);
    if (items.length) {
      started = true;
      parent = null;
      for (const item of items) {
        if (item.count === 0) {
          zero = true;
          continue;
        }
        // 機種の名前・電話番号のような数、稼働の様子の数（応対数など）、合計の行（「合計PI」。上の行と二重になる）、文（「起きました2」）は数えない
        const rawN = item.raw.normalize("NFKC");
        if (notACount(item, body) || ACTIVITY_WORDS.test(rawN) || TOTAL_WORDS.test(rawN) || SENTENCE.test(rawN)) continue;
        const tag = item.person ? tagPeople(item.person) : null;
        const l: LineReportLine = { raw: item.raw, count: item.count, shares: assign(item.count, tag), sub: false };
        lines.push(l);
        parent = items.length === 1 ? l : null;
      }
      continue;
    }
    // 件数のあとに書いた会場（「プラチナ1 / ドコモMAX2 / ドコモショップ〇〇」）
    if (!venue && VENUE_WORD.test(body) && !NOT_VENUE.test(body) && !SENTENCE.test(body) && body.length <= 30) {
      venue = body;
      continue;
    }
    // 件数のある行の下の、件数のない行（「PI1」の下の「D払い初回利用」）。親と同じ人の分として1件
    if (parent && started && !/[（(]/.test(body) && !SENTENCE.test(body)) {
      const tagPeople = parent.shares.map((s) => s.person);
      lines.push({ raw: body, count: 1, shares: splitCount(1, tagPeople.length).map((c, i) => ({ person: tagPeople[i], count: c })), sub: true });
    }
  }

  if (!lines.some((l) => !l.sub) && !zero) return null;
  if (!people.length) {
    const tagged = [...new Set(lines.flatMap((l) => l.shares.map((s) => s.person)))];
    people = tagged.length ? tagged : [msg.sender];
  }
  return { index, date, time: msg.time, sender: msg.sender, venue: venue.trim(), people, lines, zero: zero && !lines.some((l) => !l.sub) };
}

// ---------------------------------------------------------------------------
// 現場詳細（【案件詳細】）
// ---------------------------------------------------------------------------

/** 電話番号のある行（現場詳細から外す） */
const PHONE = /0\d{1,4}[-‐ー−(（]?\d{1,4}[-‐ー−)）]?\d{3,4}|0[5789]0\d{6,8}/;
/**
 * 現場詳細の投稿か（【案件詳細】・●集合場所 のお知らせ。「● 店舗 / ● 開催場所 / 当日 PI1」は件数の報告）。
 * ノート（[ノート]）は、保存したトーク履歴では最初の100文字ほどしか入らないので使わない
 */
export function readDetailPost(msg: LineMessage, index: number): LineDetailPost | null {
  const t = msg.text;
  if (t.startsWith("[ノート]") || !/【案件詳細】|●\s*集合場所/.test(t)) return null;
  const lines = t.split("\n");
  const nextAfter = (re: RegExp) => {
    const i = lines.findIndex((l) => re.test(l));
    return i >= 0 ? clean(lines.slice(i + 1).find((l) => l.trim()) ?? "") : "";
  };
  const bracket = (l: string) =>
    clean(
      (l.match(/【([^】]+)】/)?.[1] ?? "")
        .normalize("NFKC")
        .replace(/^[\d/月日〜~\-\s]+/, ""),
    );
  let venue = nextAfter(/●\s*開催場所/) || nextAfter(/^\s*【勤務地】\s*$/);
  if (!venue) venue = bracket(lines.find((l) => /【[^】]+】/.test(l) && !/案件詳細|業務内容|^\s*【店内】\s*$|【(勤務地|稼働期間|目標件数|持ち物|服装)】/.test(l)) ?? "");
  // 古くなる「稼働日程」「稼働メンバー」と、電話番号の行は外す
  const out: string[] = [];
  let skip = false;
  for (const l of lines) {
    if (/●\s*(稼働日程|稼働メンバー)|【(稼働日程|稼働メンバー|メンバー)】/.test(l)) skip = true;
    else if (/^●|^━|^【/.test(l.trim())) skip = false;
    if (!skip && !PHONE.test(l.normalize("NFKC"))) out.push(l);
  }
  return { index, date: msg.date, sender: msg.sender, venue, body: out.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}

/**
 * トーク履歴を読む（報告と現場詳細）。ノート（[ノート]）と @ で始まるお知らせは報告として読まない。
 * 会場の書いてない報告は、同じ日に同じ人の報告で会場が1つに決まればそれを使う
 */
export function readLineHistory(text: string, opts: ReadOptions = {}): LineHistory {
  const { title, messages } = splitMessages(text);
  const reports: LineReport[] = [];
  const details: LineDetailPost[] = [];
  messages.forEach((m, i) => {
    if (!m.sender) return;
    const d = readDetailPost(m, i);
    if (d) return void details.push(d);
    // ノートと、みんなへのお知らせ（@All …。例として件数が書いてあることがある）は報告ではない
    if (m.text.startsWith("[ノート]") || m.text.trimStart().startsWith("@")) return;
    const r = readReport(m, i, opts);
    if (r) reports.push(r);
  });
  for (const r of reports) {
    if (r.venue) continue;
    const who = new Set([r.sender, ...r.people]);
    const same = new Set(reports.filter((o) => o !== r && o.date === r.date && o.venue && (who.has(o.sender) || o.people.some((p) => who.has(p)))).map((o) => o.venue));
    if (same.size === 1) r.venue = [...same][0];
  }
  return { title, messages, reports, details };
}
