/**
 * 今の月のスプレッドシート（202605〜）の読み取り（Phase 1.5 の取り込み）。
 *
 * シートの形:
 * - 1行目に日付（「10/1」…）、2行目に「ランク / 名前 / 最寄り駅」と曜日
 * - 上の段: 取引先ごとに「単価 / 現場 / 人数」の3行。取引先名は1行目の左端。空欄なら直前の取引先の続き
 * - 下の段: スタッフごとに「単価 / 場所 / シフト」の3行。ランク・名前・最寄り駅は1行目の左側
 * - 右端に出勤日数・売上などの合計列（日付の列だけを読むので無視される）
 *
 * ここでは CSV の行を読むだけ。名簿・会場との突き合わせは month-sheet-plan.ts。
 */

export type SheetShift = "ok" | "maybe" | "ng";

export type SheetEventLine = {
  day: number;
  venue: string;
  required: number;
  /** 請求の人日単価（円）。空欄・読めないときは null */
  rate: number | null;
  /** 「＋交通費別」などの書き方 */
  transport: boolean;
};

export type SheetClient = { name: string; lines: SheetEventLine[] };

export type SheetStaff = {
  rank: string;
  name: string;
  station: string;
  places: { day: number; place: string }[];
  shifts: { day: number; status: SheetShift }[];
  /** 日ごとの単価（日当）。読めない値は amount: null */
  rates: { day: number; amount: number | null; raw: string }[];
};

export type ParsedMonthSheet = {
  /** 日付の行から読んだ月（1〜12）。年はシートにないので取り込み画面で選ぶ */
  month: number | null;
  days: number[];
  clients: SheetClient[];
  staff: SheetStaff[];
  warnings: string[];
};

const LABELS = ["単価", "現場", "人数", "場所", "シフト"];

const nfkc = (s: string | undefined) => (s ?? "").normalize("NFKC").trim();
const cell = (rows: string[][], r: number, c: number) => (rows[r]?.[c] ?? "").trim();

/** 「¥22,000」「22,000」「21000円＋交通費別」→ 金額と交通費別かどうか */
export function parseYen(raw: string): { amount: number | null; transport: boolean } {
  const s = nfkc(raw);
  const transport = /交通費/.test(s);
  const m = s.replace(/[¥￥,\s]/g, "").match(/^-?\d+/);
  return { amount: m ? Number(m[0]) : null, transport };
}

/**
 * ⭕️ ○ → ok、🔺 △ → maybe、❌ × → ng。
 * ⭐️（確定した日の印）は「出られる日」なので ok として読む（確定した予定そのものは「場所」の行から入る）
 */
export function parseShift(raw: string): SheetShift | null {
  const s = (raw ?? "").replace(/\uFE0F/g, "").trim();
  if (!s) return null;
  if (/^[⭕○◯〇oO⭐★]$/.test(s)) return "ok";
  if (/^[🔺△▲]$/u.test(s)) return "maybe";
  if (/^[❌×✕✖xX]$/.test(s)) return "ng";
  return null;
}

/** ⭐️ ★（確定した日の印）か。書き戻しでは、確定したときに書き、○△× で上書きしない */
export function isConfirmedMark(raw: string): boolean {
  return /^[⭐★]$/.test((raw ?? "").replace(/\uFE0F/g, "").trim());
}

export type SheetLayout = {
  headerRow: number;
  /** 日付の列（左から） */
  dayCols: { col: number; day: number }[];
  /** 日付の行から読んだ月（1〜12） */
  month: number | null;
  /** 「単価 / 現場 / 人数 / 場所 / シフト」が書いてある列 */
  labelCol: number;
  rankCol: number;
  nameCol: number;
  stationCol: number;
  /** 上の段のブロック（取引先名が空欄なら直前の取引先を引きつぐ。最初から空欄なら ""） */
  clientBlocks: { name: string; rateRow: number; venueRow: number; countRow: number }[];
  /** 下の段のブロック（名前がない行も含む。name = ""） */
  staffBlocks: { name: string; rank: string; station: string; rateRow: number; placeRow: number; shiftRow: number }[];
};

export type LayoutError = { error: "no_header" } | { error: "no_labels"; month: number | null; days: number[] };

export const NO_HEADER_WARNING = "日付の行（10/1 などが並ぶ行）が見つかりません。月のシートを CSV で保存したファイルか確認してください";
export const NO_LABELS_WARNING = "「単価 / 現場 / 人数」「単価 / 場所 / シフト」の行が見つかりません";

/**
 * 月のシートのどの行・列に何があるかを調べる（読み取り parseMonthSheet と、書き戻し sheet-writeback で共通）。
 * - 日付の行: 「10/1」が10個以上並ぶ行
 * - 「ランク / 名前 / 最寄り駅」の列: 日付の行の近くの「名前」などの見出しから（なければ左から順）
 * - 単価 / 現場 / 人数 / 場所 / シフト の列: その言葉がいちばん多く入っている列
 */
export function layoutMonthSheet(rows: string[][]): SheetLayout | LayoutError {
  const dateRe = /^(\d{1,2})\/(\d{1,2})$/;
  const headerRow = rows.findIndex((r) => r.filter((c) => dateRe.test(nfkc(c))).length >= 10);
  if (headerRow < 0) return { error: "no_header" };
  const dayCols: { col: number; day: number }[] = [];
  const months: number[] = [];
  rows[headerRow].forEach((c, col) => {
    const m = nfkc(c).match(dateRe);
    if (m) {
      months.push(Number(m[1]));
      dayCols.push({ col, day: Number(m[2]) });
    }
  });
  const month = months.sort((a, b) => months.filter((x) => x === b).length - months.filter((x) => x === a).length)[0] ?? null;

  const namesRow = rows.slice(headerRow, headerRow + 3).find((r) => r.some((c) => nfkc(c) === "名前"));
  const colOf = (label: string, fallback: number) => {
    const i = namesRow?.findIndex((c) => nfkc(c) === label) ?? -1;
    return i >= 0 ? i : fallback;
  };
  const rankCol = colOf("ランク", 0);
  const nameCol = colOf("名前", 1);
  const stationCol = colOf("最寄り駅", 2);

  const counts = new Map<number, number>();
  for (const r of rows.slice(headerRow + 1)) r.forEach((c, i) => LABELS.includes(nfkc(c)) && counts.set(i, (counts.get(i) ?? 0) + 1));
  const labelCol = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (labelCol == null) return { error: "no_labels", month, days: dayCols.map((d) => d.day) };
  const label = (r: number) => nfkc(rows[r]?.[labelCol]);

  const clientBlocks: SheetLayout["clientBlocks"] = [];
  const staffBlocks: SheetLayout["staffBlocks"] = [];
  let currentClient = "";
  for (let r = headerRow + 1; r < rows.length; r++) {
    if (label(r) !== "単価") continue;
    if (label(r + 1) === "現場" && label(r + 2) === "人数") {
      const name = rows[r].slice(0, labelCol).map((c) => c.trim()).find(Boolean);
      if (name) currentClient = name;
      clientBlocks.push({ name: currentClient, rateRow: r, venueRow: r + 1, countRow: r + 2 });
      r += 2;
      continue;
    }
    if (label(r + 1) === "場所" && label(r + 2) === "シフト") {
      const pick = (col: number) => [r, r + 1, r + 2].map((i) => cell(rows, i, col)).find(Boolean) ?? "";
      staffBlocks.push({ name: pick(nameCol), rank: pick(rankCol), station: pick(stationCol), rateRow: r, placeRow: r + 1, shiftRow: r + 2 });
      r += 2;
    }
  }
  return { headerRow, dayCols, month, labelCol, rankCol, nameCol, stationCol, clientBlocks, staffBlocks };
}

export function parseMonthSheet(rows: string[][]): ParsedMonthSheet {
  const warnings: string[] = [];
  const lay = layoutMonthSheet(rows);
  if ("error" in lay) {
    if (lay.error === "no_header") return { month: null, days: [], clients: [], staff: [], warnings: [NO_HEADER_WARNING] };
    return { month: lay.month, days: lay.days, clients: [], staff: [], warnings: [NO_LABELS_WARNING] };
  }
  const { dayCols, month } = lay;

  const clients: SheetClient[] = [];
  for (const b of lay.clientBlocks) {
    const current = b.name ? (clients.find((c) => c.name === b.name) ?? { name: b.name, lines: [] }) : null;
    if (current && !clients.includes(current)) clients.push(current);
    for (const { col, day } of dayCols) {
      const venue = cell(rows, b.venueRow, col);
      if (!venue) continue;
      if (!current) {
        warnings.push(`${b.venueRow + 1}行目: 取引先名がないので「${venue}」（${day}日）は取り込みません`);
        continue;
      }
      const n = Number.parseInt(nfkc(cell(rows, b.countRow, col)), 10);
      if (!(n > 0)) warnings.push(`${current.name}「${venue}」${day}日: 人数が空欄・0 なので1人にしました`);
      const { amount, transport } = parseYen(cell(rows, b.rateRow, col));
      current.lines.push({ day, venue, required: n > 0 ? n : 1, rate: amount != null && amount > 0 ? amount : null, transport });
    }
  }

  const staff: SheetStaff[] = [];
  for (const b of lay.staffBlocks) {
    const s: SheetStaff = { rank: b.rank, name: b.name, station: b.station, places: [], shifts: [], rates: [] };
    for (const { col, day } of dayCols) {
      const place = cell(rows, b.placeRow, col);
      if (place) s.places.push({ day, place });
      const raw = cell(rows, b.shiftRow, col);
      const shift = parseShift(raw);
      if (shift) s.shifts.push({ day, status: shift });
      else if (raw) warnings.push(`${b.name || `${b.shiftRow + 1}行目`} ${day}日: シフト「${raw}」は読めないので取り込みません`);
      const rateRaw = cell(rows, b.rateRow, col);
      if (rateRaw) s.rates.push({ day, amount: parseYen(rateRaw).amount, raw: rateRaw });
    }
    if (b.name) staff.push(s);
    else if (s.places.length || s.shifts.length) warnings.push(`${b.placeRow + 1}行目: 名前がないスタッフの行は取り込みません`);
  }

  return { month, days: dayCols.map((d) => d.day), clients, staff, warnings };
}

/** シートの月（1〜12）から、今日にいちばん近い年の YYYY-MM を選ぶ（同じ近さなら過去） */
export function guessMonth(m: number | null, today: string): string {
  const y = Number(today.slice(0, 4));
  const cur = y * 12 + Number(today.slice(5, 7)) - 1;
  if (!m || m < 1 || m > 12) return today.slice(0, 7);
  const best = [y - 1, y, y + 1].map((yy) => yy * 12 + m - 1).sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur) || a - b)[0];
  return `${Math.floor(best / 12)}-${String((best % 12) + 1).padStart(2, "0")}`;
}
