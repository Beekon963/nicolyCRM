/**
 * 案件まわりの LINE の文を読む（Phase 21。DB を使わない）。
 *
 * 1. 案件の文（取引先から）。書き方は取引先ごとに違うので、行を要素に分解して読む:
 *    - 見出し: ■ 日程 / ■ 店舗 / 単価 / 稼働時間 / エントリー期限 / 備考 / 【日程】1/2・1/3（■ や単独の行は全体の見出し、【】や「日程:」は直前の店舗の日程）
 *    - 店舗の行: 「① 〇〇店」「・〇〇モール →25名」「20 〇〇外販 1名」「7日 〇〇軒先 1名」「1/2・1/3 〇〇店 各日2名」
 *    - 店舗の日程: 店舗の行の直後の「【日程】1/2・1/3」や日付だけの行。店舗より前に日程が書いてあるときは、その日程を次の店舗に当てる
 *    - 全体の日程: 「■ 日程 1/1〜1/4」。自分の日程を持たない店舗に当てる
 *    - 金額の行（円・単価・報酬）は単価のまわりの文（rateLines）として別に持つ（オーナーだけが見る）
 *    - 期限: 「■ エントリー期限 11/20まで」「締切 11/20」
 * 2. 面談候補日の返事（本人から）: 「10/26 20:00〜」「10月27日(火)15時以降」「10/28 終日」
 * 3. 合否の連絡（取引先から）: 「〇〇さん合格です」「△△は不合格」「合格: A、B」
 * 4. 人員変更の文（取引先から）: 「10月30日の〇〇 △△欠員のため人員変更。□□ Aと B / 〇〇 C」
 * 読むだけで、CRM の人・会場への当てはめと登録はサーバー側（inbox/actions・proposals）で行う。
 */
import { addDays, type DateString, monthOf, nextMonth, resolveMonthDay } from "@/lib/date";

const nfkc = (s: string) => s.normalize("NFKC");
const pad = (n: number | string) => String(n).padStart(2, "0");

// ---------------------------------------------------------------------------
// 日付の読み取り（「1/2・1/3・1/4」「1/1〜1/4」「11月5日」「11/1・5・6」「2026/1/2」）
// ---------------------------------------------------------------------------

const MD_RANGE = /(?:\d{4}\s*[/年.\-]\s*)?(\d{1,2})\s*[/月]\s*(\d{1,2})日?\s*(?:\([^)]*\))?\s*[〜~～\-－]\s*(?:(\d{1,2})\s*[/月]\s*)?(\d{1,2})日?/g;
const MD = /(?<![\d/])(?:\d{4}\s*[/年.\-]\s*)?(\d{1,2})\s*[/月]\s*(\d{1,2})日?/g;
/** 時刻（「10:00」「15時」「9時半」「18時30分」）。日付と間違えないように先に消す */
const TIME_LIKE = /\d{1,2}:\d{2}|\d{1,2}\s*時(?:\s*半|\s*\d{1,2}\s*分)?/g;

/**
 * 文の中の日付を全部読む（範囲は展開）。「11/1・5・6」の 5・6 は前の月を引きつぐ。
 * 「15時〜19時」「10:00」のような時刻や「1名」は日付にしない
 */
export function parseDateList(text: string, today: DateString, ctx: { month: number | null } = { month: null }): DateString[] {
  const t = nfkc(text).replace(TIME_LIKE, " ");
  const out: DateString[] = [];
  const used = new Set<number>();
  for (const m of t.matchAll(MD_RANGE)) {
    const m1 = Number(m[1]);
    const from = resolveMonthDay(m1, Number(m[2]), today);
    const to = resolveMonthDay(m[3] ? Number(m[3]) : m1, Number(m[4]), today);
    if (from && to && from <= to) for (let d = from, i = 0; d <= to && i < 62; d = addDays(d, 1), i++) out.push(d);
    ctx.month = m[3] ? Number(m[3]) : m1;
    for (let i = m.index!; i < m.index! + m[0].length; i++) used.add(i);
  }
  for (const m of t.matchAll(MD)) {
    if (used.has(m.index!)) continue;
    ctx.month = Number(m[1]);
    const d = resolveMonthDay(ctx.month, Number(m[2]), today);
    if (d) out.push(d);
    for (let i = m.index!; i < m.index! + m[0].length; i++) used.add(i);
  }
  // 「・5・6」「、6日」のように日だけ続くもの（直前に月のある日付があるときだけ）
  if (ctx.month) {
    const rest = t.replace(MD_RANGE, " ").replace(MD, " ");
    if (out.length || /[・、,，]/.test(rest) || /^\s*\d{1,2}\s*日?\s*$/.test(rest)) {
      for (const m of rest.matchAll(/(?:^|[・、,，\s])(\d{1,2})日?(?=$|[・、,，\s）)])/g)) {
        const day = Number(m[1]);
        if (day < 1 || day > 31) continue;
        const d = resolveMonthDay(ctx.month, day, today);
        if (d) out.push(d);
      }
    }
  }
  return [...new Set(out)].sort();
}

const md = (d: DateString) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 日付の並びを「1/1〜1/4・1/6」の形に戻す（3日以上続く日は〜でまとめる。parseDateList で読み直せる） */
export function datesToText(dates: DateString[]): string {
  const ds = [...new Set(dates)].sort();
  const parts: string[] = [];
  let i = 0;
  while (i < ds.length) {
    let j = i;
    while (j + 1 < ds.length && ds[j + 1] === addDays(ds[j], 1)) j++;
    parts.push(j - i >= 2 ? `${md(ds[i])}〜${md(ds[j])}` : ds.slice(i, j + 1).map(md).join("・"));
    i = j + 1;
  }
  return parts.join("・");
}

// ---------------------------------------------------------------------------
// 1. 案件の文
// ---------------------------------------------------------------------------

export type JobOfferLine = { date: DateString; day: number; venue: string; count: number };

export type JobOfferVenue = {
  name: string;
  /** その店舗の必要人数（「→25名」「各日1名」。書いてなければ「人数」の見出しの数、なければ 1） */
  count: number;
  /** その店舗の日程（なければ全体の日程を使う） */
  dates: DateString[];
  /** 日程が書いてあった文そのまま（画面で直す用） */
  dateText: string;
};

export type JobOfferParse = {
  /** 店舗ごと（読んだ順） */
  venues: JobOfferVenue[];
  /** 全体の日程（■ 日程 1/1〜1/4 など。店舗に日程がないときに使う） */
  globalDates: DateString[];
  /** 展開した 日 × 店舗（日付順。日程のない店舗は入らない） */
  lines: JobOfferLine[];
  /** 文から分かった月（YYYY-MM）。日程がなければ null */
  month: string | null;
  /** 請求の人日単価（円）。「単価 22000円/日」「一律 24,000円」。なければ null */
  rate: number | null;
  /** 金額のまわりの文（単価・報酬・円の行そのまま。オーナーだけが見る） */
  rateLines: string[];
  transportIncluded: boolean;
  /** 稼働時間（最初の1つ。HH:MM） */
  start: string | null;
  end: string | null;
  /** 稼働時間の書き方そのまま（「10:00〜18:00 or 11:00〜19:00」） */
  hoursNote: string;
  /** エントリー期限（「11/20まで」） */
  entryDeadline: DateString | null;
  /** 備考（条件・注意・※ の行。金額の行は入れない） */
  notes: string;
  /** 「20 〇〇外販 1名」「1/2 〇〇店 3名」の形（日付と人数が同じ行）の行の数 */
  dayLines: number;
  /** 「① 〇〇店」「・〇〇店 →25名」のように印の付いた店舗の数 */
  markedVenues: number;
};

type Section = "dates" | "venues" | "rate" | "hours" | "deadline" | "notes" | "count" | null;

/** 見出しの言葉（見出しの部分がこれと一致するとき） */
const HEADER_WORDS: { re: RegExp; section: Section }[] = [
  { re: /^(日程|日付|日時|稼働日|稼働日程|募集日|開催日|開催日程|実施日|実施日程|候補日)$/, section: "dates" },
  { re: /^(店舗|店舗名|会場|場所|稼働場所|稼働店舗|現場|勤務地|実施店舗|実施場所|開催場所|エリア)$/, section: "venues" },
  { re: /^(単価|報酬|金額|時給|日当|料金|費用|人日単価|給与|ギャラ)$/, section: "rate" },
  { re: /^(稼働時間|時間|勤務時間|実施時間|稼働時刻)$/, section: "hours" },
  { re: /^(エントリー期限|エントリー締切|エントリー|期限|締切|締め切り|応募期限|回答期限|返答期限|返事期限|回答締切)$/, section: "deadline" },
  { re: /^(備考|注意|注意事項|条件|募集条件|必須条件|求める人物|その他|服装|持ち物|業務内容|概要|案件概要)$/, section: "notes" },
  { re: /^(人数|募集人数|必要人数|募集|定員)$/, section: "count" },
];

/** 「■ 日程」「【日程】1/2・1/3」「〈募集日〉11/1」「単価:」「エントリー期限 11/20まで」の見出しを読む。rest は見出しの後ろの文 */
function readHeader(line: string): { section: Section; rest: string } | null {
  const m = line.match(/^(?:[■□◆◇●▼▽★☆◎]\s*)?(?:[【\[〈《（(]\s*)?([^】\]〉》）):：\s]{1,10})(?:\s*[】\]〉》）)])?\s*[:：]?\s*(.*)$/);
  if (!m) return null;
  const head = m[1].trim();
  for (const h of HEADER_WORDS) {
    if (h.re.test(head)) return { section: h.section, rest: m[2].replace(/^[（(][^)）]*[)）]\s*/, "").trim() };
  }
  return null;
}

const CIRCLED = /^[①-⑳㉑-㉟⓵-⓾]\s*/u;
const NUMBERED = /^(?:\(\d{1,2}\)|\d{1,2}\s*[.)])\s*(?=\D)/;
const BLOCK_MARK = /^[■□◆◇●▼▽★☆◎]/;
const BULLET = /^[・･●◎▶▷♦◆■□\-－―‐]\s*/;
/** 「→25名」「各日1名」「1〜2名」「3名程度」（行の最後） */
const COUNT = /(?:[→⇒＝=:：]\s*)?(?:各日|各|計|合計)?\s*(\d{1,3})(?:\s*[〜~～\-－]\s*(\d{1,3}))?\s*名(?:様|程度|ほど|ずつ|体制|募集|必要|予定)?\s*$/;
/** 「20 〇〇外販 1名」「7日 〇〇軒先 1名」「27,28 〇〇外販 2名」「22〇〇軒先1名」 */
const DAY_VENUE_COUNT = /^(\d{1,2}(?:\s*[,、，・]\s*\d{1,2})*)\s*日?\s*(\S.*?)\s*(?:各日|各|計|合計)?\s*(\d{1,3})\s*名(?:様|程度|ほど|ずつ|体制|募集|必要|予定)?\s*$/;
/** 「7日 〇〇軒先」「20 〇〇外販」（人数なし。店舗の見出しの下か、人数が別に書いてあるときだけ） */
const DAY_VENUE = /^(\d{1,2}(?:\s*[,、，・]\s*\d{1,2})*)\s*(?:日\s*|\s+)(\S.*)$/;
/** 「1/2 〇〇店 3名」「1/2・1/3 〇〇店 各日2名」「1/2(金) 〇〇店 3名」 */
const DATE_VENUE_COUNT = /^((?:\d{1,2}\s*[/月]\s*\d{1,2}日?(?:\s*\([^)]*\))?)(?:\s*[・、,，〜~～\-－]\s*\d{1,2}(?:\s*[/月]\s*\d{1,2})?日?(?:\s*\([^)]*\))?)*)\s+(\S.*?)\s*(?:各日|各|計|合計)?\s*(\d{1,3})\s*名(?:様|程度|ほど|ずつ|体制|募集|必要|予定)?\s*$/;
const TIME_RANGE = /(\d{1,2})(?::(\d{2})|\s*時(?:\s*(\d{2})\s*分|半)?)\s*[〜~～\-－]\s*(\d{1,2})(?::(\d{2})|\s*時(?:\s*(\d{2})\s*分|半)?)/g;
const HAS_TIME_RANGE = /\d{1,2}(?::\d{2}|\s*時(?:半|\s*\d{1,2}\s*分)?)\s*[〜~～\-－]\s*\d{1,2}(?::\d{2}|\s*時)/;
const HAS_MD = /\d{1,2}\s*[/月]\s*\d{1,2}/;
/** 金額の行（数字＋円、¥、単価・報酬など） */
const MONEY = /\d\s*円|[¥￥]\s*\d|単価|報酬|時給|日当(?!た)|給与|人日|ギャラ/;
/** あいさつ・前置き（読まない） */
const SKIP_LINE = /^(お世話にな|お疲れ様|お疲れさま|よろしくお願い|宜しくお願い|以上|ご確認|お待ち|下記|以下|こちら|いつも)|(お願い(します|致します|いたします)|ご案内です|ご連絡です|ご相談です|お送りします|送付します)[。!！]*$/;
const VENUE_WORD = /(店|モール|ショップ|カメラ|デンキ|電機|イオン|ららぽーと|アウトレット|DS|ドコモ|ソフトバンク|au|楽天|外販|軒先|催事|イベント|ヨーカドー|西友|マックス|MAX|センター|プラザ|タウン|シティ|パーク|ビル|館|会場|駅|広場|エリア)/i;
const SENTENCE = /(に関して|の方|優先|可能|ください|下さい|です|ます|ました|要相談|のみ|お願い|不可|必須|歓迎|経験|募集|変更|欠員|連絡|ため|予定|こと)/;
/** 役割・人の言葉（店舗の名前ではない） */
const ROLE_WORD = /^(クローザー|キャッチ|スタッフ|経験者|未経験|リーダー|サポート|MC|人員|人数|募集|各日|合計|計|男性|女性|男女|名|人|弱|強|強クロ|弱クロ)/;

const timeText = (h: string, m: string | undefined, half?: boolean) => `${pad(h)}:${m ?? (half ? "30" : "00")}`;
const splitDays = (s: string) =>
  s
    .split(/[,、，・]/)
    .map((d) => Number(d.trim()))
    .filter((d) => d >= 1 && d <= 31);
/** 店舗の名前を比べる形（空白・記号・大文字小文字の違いをなくす） */
const venueKey = (s: string) => nfkc(s).toLowerCase().replace(/[\s・/／\-－―‐()（）]/g, "");

/** 店舗の名前として通るか（記号だけ・1文字・役割の言葉は店舗にしない） */
function isVenueName(name: string): boolean {
  const core = name.replace(/[^一-龠々ぁ-んァ-ヶA-Za-z0-9]/g, "");
  if (core.length < 2 || !/[一-龠々ぁ-んァ-ヶA-Za-z]/.test(core)) return false;
  if (ROLE_WORD.test(name.trim()) || /^(各日|程度|以上|以下|まで|から|合計|計|名様?|人|休み|休|未定|調整|終日|午前|午後)$/.test(core)) return false;
  // 「コジマ×ビックカメラ」の × は名前の一部。印だけ・前後が空白の印（稼働可能日の ○△×）は店舗にしない
  if (/(^|\s)[○◯〇⭕△▲🔺×✕✖❌✗](\s|$)/u.test(name) || HAS_TIME_RANGE.test(name)) return false;
  return true;
}

function cleanVenueName(name: string): string {
  return name
    .replace(COUNT, "")
    .replace(TIME_RANGE, "")
    .replace(/\s*(各日|各|計|合計)\s*$/, "")
    .replace(/[→⇒＝=:：、,，・]\s*$/, "")
    .replace(BULLET, "")
    .replace(/[（(【\[]\s*$/, "")
    .replace(/[（(]\s*[)）]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type Prepared = { line: string; body: string; marked: boolean; bullet: boolean; note: boolean };

/** 1行の下ごしらえ: ①② や「1.」「(1)」の番号を外し（印として覚える）、全角を半角にそろえる */
function prepareLine(raw: string): Prepared {
  let s = raw.replace(/[ \t　]+/g, " ").trim();
  let marked = false;
  const c = s.match(CIRCLED);
  if (c) {
    s = s.slice(c[0].length);
    marked = true;
  }
  s = nfkc(s).replace(/[ \t　]+/g, " ").trim();
  const n = s.match(NUMBERED);
  if (n && !HAS_MD.test(s.slice(0, n[0].length + 3))) {
    s = s.slice(n[0].length).trim();
    marked = true;
  }
  const bullet = BULLET.test(s);
  const body = s.replace(BULLET, "").trim();
  return { line: s, body, marked, bullet, note: /^[※*＊]/.test(body) };
}

/** own = 日程が文に書いてあった、given = 人数が文に書いてあった（なければ「人数」の見出しの数を最後に入れる） */
type VenueAcc = JobOfferVenue & { own: boolean; given: boolean };

export function parseJobOffer(text: string, today: DateString): JobOfferParse {
  const prepared = text
    .replace(/\r/g, "")
    .split("\n")
    .map(prepareLine)
    .filter((p) => p.line);
  const venues: VenueAcc[] = [];
  const globalDates: DateString[] = [];
  const rateLines: string[] = [];
  const notes: string[] = [];
  let rate: number | null = null;
  let transportIncluded = false;
  let hoursNote = "";
  let start: string | null = null;
  let end: string | null = null;
  let entryDeadline: DateString | null = null;
  let defaultCount: number | null = null;
  let section: Section = null;
  let dayLines = 0;
  let markedVenues = 0;
  /** 日程の書き方: backward = 店舗の行の後ろに日程、forward = 日程の後ろに店舗（最初に出てきた順で決める） */
  let mode: "forward" | "backward" | null = null;
  /** forward のとき、次の店舗に当てる日程 */
  let groupDates: DateString[] | null = null;
  let groupText = "";
  /** 日程がまだ付いていない直近の店舗（backward で次の日程を当てる） */
  let pendingVenue: VenueAcc | null = null;
  let prevKind: "venue" | "dates" | "other" = "other";
  const dateCtx = { month: null as number | null };

  // 月: 最初の5行の「11月」→ 文の中の最初の「1/2」「11月5日」の月 → 日だけの行なら「今日の日」以降なら今月、過ぎていれば来月
  const headerMonth = prepared.slice(0, 5).map((p) => p.line.match(/^(\d{1,2})月/)).find(Boolean)?.[1];
  const firstMd = nfkc(text).replace(TIME_LIKE, " ").match(/(?<![\d/])(?:\d{4}\s*[/年.\-]\s*)?(\d{1,2})\s*[/月]\s*\d{1,2}/);
  if (headerMonth) dateCtx.month = Number(headerMonth);
  else if (firstMd) dateCtx.month = Number(firstMd[1]);
  else {
    const days = prepared.filter((p) => !p.marked).flatMap((p) => {
      const m = p.body.match(DAY_VENUE_COUNT);
      return m && isVenueName(m[2]) ? splitDays(m[1]) : [];
    });
    if (days.length) {
      const todayDay = Number(today.slice(8, 10));
      const base = Math.min(...days) >= todayDay ? monthOf(today) : nextMonth(monthOf(today));
      dateCtx.month = Number(base.slice(5, 7));
    }
  }
  const dayDates = (days: number[]) => days.map((d) => (dateCtx.month ? resolveMonthDay(dateCtx.month, d, today) : null)).filter((d): d is DateString => Boolean(d));

  const addHours = (line: string) => {
    const ranges = [...line.matchAll(TIME_RANGE)].map((m) => {
      const [from, to] = m[0].split(/[〜~～\-－]/);
      return `${timeText(m[1], m[2] ?? m[3], /半/.test(from))}〜${timeText(m[4], m[5] ?? m[6], /半/.test(to ?? ""))}`;
    });
    if (!ranges.length) return false;
    hoursNote = [hoursNote, ...ranges].filter(Boolean).join(" or ");
    if (!start) {
      start = ranges[0].slice(0, 5);
      end = ranges[0].slice(6, 11);
    }
    return true;
  };
  const addMoney = (line: string) => {
    rateLines.push(line);
    const flat = line.match(/一律\s*[:：]?\s*(\d[\d,]{2,})\s*円/);
    const amounts = [...line.matchAll(/(\d[\d,]{2,})\s*円/g)].map((m) => Number(m[1].replace(/,/g, "")));
    if (flat) rate = Number(flat[1].replace(/,/g, ""));
    else if (amounts.length && (rate == null || /単価|日当/.test(line))) rate = amounts[0];
  };
  /**
   * 店舗を足す。merge = true のとき同じ名前の店舗があれば人数・日程をそこに重ねる（「① A店 … ・A店 →25名」）。
   * 「20 A店 1名 / 21 A店 2名」のように行ごとに日程と人数が違う書き方は merge = false で別々に持つ
   */
  const addVenue = (nameText: string, countText: string, inlineDates: string, isMarked: boolean, merge = true): VenueAcc | null => {
    const cm = countText.match(COUNT);
    const name = cleanVenueName(nameText);
    if (!isVenueName(name)) return null;
    let v = merge ? venues.find((x) => venueKey(x.name) === venueKey(name)) : undefined;
    if (v) {
      if (cm) {
        v.count = Number(cm[2] ?? cm[1]);
        v.given = true;
      }
    } else {
      v = { name, count: cm ? Number(cm[2] ?? cm[1]) : (defaultCount ?? 1), dates: [], dateText: "", own: false, given: Boolean(cm) };
      venues.push(v);
      if (isMarked) markedVenues++;
    }
    if (inlineDates) {
      const ds = parseDateList(inlineDates, today, dateCtx);
      if (ds.length) {
        v.dates = ds;
        v.dateText = inlineDates.trim();
        v.own = true;
      }
    }
    if (!v.own && groupDates) {
      v.dates = groupDates;
      v.dateText = groupText;
    }
    if (mode === null) mode = "backward";
    pendingVenue = v.own ? null : v;
    prevKind = "venue";
    return v;
  };
  /** 日程の行・見出し。block = 「■ 日程」のような全体の見出し */
  const onDates = (ds: DateString[], txt: string, block: boolean, bare: boolean) => {
    if (block) {
      globalDates.push(...ds);
      groupDates = null;
      pendingVenue = null;
      prevKind = "dates";
      return;
    }
    if (mode === null) mode = venues.length ? "backward" : "forward";
    const target = prevKind === "venue" && pendingVenue && (mode === "backward" || bare) ? pendingVenue : null;
    if (target) {
      target.dates = ds;
      target.dateText = txt.trim();
      target.own = true;
      pendingVenue = null;
    } else if (mode === "forward") {
      groupDates = ds;
      groupText = txt.trim();
    } else globalDates.push(...ds);
    prevKind = "dates";
  };

  /** 見出しだけの行（「■ 日程」）のあと、次の日付の行をどう扱うか */
  let pendingHeader: { block: boolean } | null = null;

  for (const p of prepared) {
    const { line, body, marked, bullet, note } = p;
    if (section !== "notes" && SKIP_LINE.test(line) && !/締切|期限|エントリー/.test(line) && !HAS_MD.test(line)) continue;
    if (/交通費\s*(込|含)/.test(line)) transportIncluded = true;

    // 見出し
    const h = marked ? null : readHeader(line);
    if (h) {
      section = h.section;
      const rest = h.rest;
      const block = BLOCK_MARK.test(line);
      pendingHeader = null;
      if (section === "dates") {
        if (!rest) {
          pendingHeader = { block };
          if (block) {
            pendingVenue = null;
            groupDates = null;
          }
          continue;
        }
        const ds = parseDateList(rest, today, dateCtx);
        if (ds.length) onDates(ds, rest, block, false);
        continue;
      }
      // ■ 単価 のような全体の見出しが来たら、前の店舗に日程が続くことはない
      if (block) pendingVenue = null;
      if (!rest) continue;
      if (section === "deadline") {
        entryDeadline = parseDateList(rest, today, { month: dateCtx.month })[0] ?? entryDeadline;
        continue;
      }
      if (section === "rate") {
        addMoney(rest);
        continue;
      }
      if (section === "hours") {
        if (!addHours(rest)) notes.push(rest);
        continue;
      }
      if (section === "count") {
        const c = rest.match(/(\d{1,3})(?:\s*[〜~～\-－]\s*(\d{1,3}))?\s*名/);
        if (c) defaultCount = Number(c[2] ?? c[1]);
        if (c && !/^(各日|各|計|合計)?\s*\d{1,3}(?:\s*[〜~～\-－]\s*\d{1,3})?\s*名(?:様|程度|ほど|ずつ)?\s*$/.test(rest)) notes.push(rest);
        continue;
      }
      if (section === "notes") {
        if (!MONEY.test(rest)) notes.push(rest);
        continue;
      }
      if (section === "venues") {
        addVenue(rest, rest, "", false);
        continue;
      }
      continue;
    }

    // 金額の行（どこにあっても。オーナーだけが見る）
    if (MONEY.test(line) && !COUNT.test(body)) {
      addMoney(line);
      prevKind = "other";
      continue;
    }
    // ※ の行は備考
    if (note) {
      notes.push(body);
      prevKind = "other";
      continue;
    }
    // 期限の行（「11/20まで」「締切 11/20(木)」）
    const deadlineLike = section === "deadline" || /締切|締め切り|期限|エントリー|応募|回答|返答|返事/.test(line) || (/まで\s*[。!！]*$/.test(line) && section !== "dates" && !/[〜~～\-－]/.test(line) && !pendingVenue);
    if (deadlineLike) {
      const d = parseDateList(line, today, { month: dateCtx.month })[0];
      if (d) {
        entryDeadline = d;
        prevKind = "other";
        continue;
      }
      if (section === "deadline") {
        notes.push(body);
        continue;
      }
    }

    const hasCount = COUNT.test(body);
    const arrowCount = /[→⇒]\s*(?:各日|各)?\s*\d{1,3}(?:\s*[〜~～\-－]\s*\d{1,3})?\s*名/.test(body);
    // 「クローザー 2名」「各日1名」: 店舗ではなく人数
    if (hasCount && !marked) {
      const nameOnly = cleanVenueName(body);
      if (!nameOnly || ROLE_WORD.test(nameOnly) || /^(各日|各|計|合計)/.test(body)) {
        const c = body.match(COUNT);
        if (c && (defaultCount == null || section === "count")) defaultCount = Number(c[2] ?? c[1]);
        if (nameOnly) notes.push(body);
        prevKind = "other";
        continue;
      }
    }

    // 「20 〇〇外販 1名」「7日 〇〇軒先 1名」「1/2・1/3 〇〇店 各日2名」（日付 ＋ 店舗 ＋ 人数）
    if (!marked) {
      const dv = body.match(DATE_VENUE_COUNT);
      if (dv && isVenueName(cleanVenueName(dv[2]))) {
        const ds = parseDateList(dv[1], today, dateCtx);
        const v = addVenue(dv[2], body, "", false, false);
        if (v && ds.length) {
          v.dates = ds;
          v.dateText = dv[1].trim();
          v.own = true;
          pendingVenue = null;
        }
        dayLines++;
        continue;
      }
      const dl = body.match(DAY_VENUE_COUNT);
      if (dl && isVenueName(cleanVenueName(dl[2]))) {
        const v = addVenue(dl[2], body, "", false, false);
        if (v) {
          v.dates = dayDates(splitDays(dl[1]));
          v.dateText = datesToText(v.dates);
          v.own = true;
          pendingVenue = null;
        }
        dayLines++;
        if (section === null) section = "venues";
        continue;
      }
      // 「7日 〇〇軒先」（人数なし）: 店舗の見出しの下か、人数が別に書いてあるときだけ
      const dn = (section === "venues" || defaultCount != null) && !HAS_MD.test(body) ? body.match(DAY_VENUE) : null;
      if (dn && isVenueName(cleanVenueName(dn[2])) && !SENTENCE.test(dn[2])) {
        const v = addVenue(dn[2], "", "", false, false);
        if (v) {
          v.dates = dayDates(splitDays(dn[1]));
          v.dateText = datesToText(v.dates);
          v.own = true;
          pendingVenue = null;
        }
        continue;
      }
    }

    // 稼働時間の行（店舗の行に時間が付いているときは店舗として読み、時間も拾う）
    if (!marked && !hasCount && (section === "hours" || HAS_TIME_RANGE.test(line))) {
      if (addHours(line)) {
        prevKind = "other";
        continue;
      }
      if (/^(or|または|もしくは|か)$/i.test(line)) continue;
      if (section === "hours") {
        notes.push(body);
        continue;
      }
    }

    // 店舗の行（①②…、・〇〇店 →25名、店舗の見出しの下の行、・〇〇モール）
    const sentence = SENTENCE.test(body) && !hasCount;
    const startsWithDate = /^\d{1,2}\s*[/月]\s*\d{1,2}/.test(body);
    const looksVenue = !startsWithDate && (marked || (hasCount && (section !== "notes" || VENUE_WORD.test(body))) || (section === "venues" && !sentence) || (bullet && !sentence && VENUE_WORD.test(body)));
    if (looksVenue) {
      // 「〇〇店 1/2・1/3」「〇〇店（1/2・1/3）→3名」のように同じ行に日程があるとき
      const inline = body.match(/^(.*?)\s*[（(]?\s*((?:\d{1,2}\s*[/月]\s*\d{1,2}日?)(?:.*)?)$/);
      const nameText = inline ? inline[1] : body;
      if (HAS_TIME_RANGE.test(body)) addHours(body);
      const v = addVenue(nameText, body, inline?.[2] ?? "", marked || arrowCount);
      if (v) continue;
    }
    // 日付だけの行（店舗の日程、または全体の日程）
    if (HAS_MD.test(line) && !SENTENCE.test(line.replace(/予定|まで/g, ""))) {
      const ds = parseDateList(line, today, dateCtx);
      if (ds.length) {
        onDates(ds, line, pendingHeader?.block ?? false, !pendingHeader);
        pendingHeader = null;
        continue;
      }
    }
    pendingHeader = null;
    // そのほかは備考（条件の行など。店舗の見出しの下の読めない行は入れない）
    if (section !== "venues" || sentence) notes.push(body);
    prevKind = "other";
  }

  // 人数が書いてない店舗には「人数」の見出しの数（文の最後に書いてあることもある）
  for (const v of venues) if (!v.given && defaultCount != null) v.count = defaultCount;
  // 展開（店舗 × その店舗の日程。日程がなければ全体の日程）
  const byKey = new Map<string, JobOfferLine>();
  for (const v of venues) {
    const dates = v.dates.length ? v.dates : globalDates;
    for (const date of dates) {
      const k = `${date}|${v.name}`;
      const cur = byKey.get(k);
      if (!cur || cur.count < v.count) byKey.set(k, { date, day: Number(date.slice(8, 10)), venue: v.name, count: v.count });
    }
  }
  const lines = [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue, "ja"));
  const uniq = (xs: string[]) => [...new Set(xs)];
  const sortedGlobal = [...new Set(globalDates)].sort();
  return {
    venues: venues.map((v) => ({ name: v.name, count: v.count, dates: v.dates, dateText: v.dateText })),
    globalDates: sortedGlobal,
    lines,
    month: lines[0]?.date.slice(0, 7) ?? sortedGlobal[0]?.slice(0, 7) ?? null,
    rate,
    rateLines: uniq(rateLines),
    transportIncluded,
    start,
    end,
    hoursNote,
    entryDeadline,
    notes: uniq(notes).join("\n").trim(),
    dayLines,
    markedVenues,
  };
}

/**
 * 案件の文らしいか。
 * - 「20 〇〇外販 1名」の形の行が2つ以上
 * - 店舗が2つ以上あって日程か期限がある
 * - ①②・→N名 の印の付いた店舗があって日程がある
 * - 店舗か日程が1つ以上あって、単価・エントリー期限・報酬の言葉がある
 * 店舗が1つで日付が並ぶだけの文（募集の文。Phase 9）は案件の文にしない
 */
export function looksLikeJobOffer(p: JobOfferParse, text: string): boolean {
  if (p.dayLines >= 2) return true;
  const hasDates = p.lines.length > 0 || p.globalDates.length > 0;
  if (p.venues.length >= 2 && (hasDates || p.entryDeadline)) return true;
  if (p.markedVenues >= 1 && hasDates) return true;
  return (p.venues.length >= 1 || p.lines.length >= 1) && /単価|エントリー|期限|締切|報酬|人日|ギャラ/.test(nfkc(text));
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
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const l = nfkc(raw).replace(/[ \t　]+/g, " ").trim();
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
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const l = nfkc(raw).replace(/[ \t　]+/g, " ").trim();
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
  const ls = text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => nfkc(l).replace(/[ \t　]+/g, " ").trim())
    .filter(Boolean);
  if (!ls.length || !/欠員|人員変更|入れ替え/.test(ls.join("\n"))) return null;
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
