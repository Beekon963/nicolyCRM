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

/** ⭕️ ○ → ok、🔺 △ → maybe、❌ × → ng */
export function parseShift(raw: string): SheetShift | null {
  const s = (raw ?? "").replace(/️/g, "").trim();
  if (!s) return null;
  if (/^[⭕○◯〇oO]$/.test(s)) return "ok";
  if (/^[🔺△▲]$/u.test(s)) return "maybe";
  if (/^[❌×✕✖xX]$/.test(s)) return "ng";
  return null;
}

export function parseMonthSheet(rows: string[][]): ParsedMonthSheet {
  const warnings: string[] = [];

  // 日付の行（「10/1」が10個以上並ぶ行）
  const dateRe = /^(\d{1,2})\/(\d{1,2})$/;
  const headerRow = rows.findIndex((r) => r.filter((c) => dateRe.test(nfkc(c))).length >= 10);
  if (headerRow < 0) {
    return { month: null, days: [], clients: [], staff: [], warnings: ["日付の行（10/1 などが並ぶ行）が見つかりません。月のシートを CSV で保存したファイルか確認してください"] };
  }
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

  // 「ランク / 名前 / 最寄り駅」の列（見つからなければ左から順に）
  const namesRow = rows.slice(headerRow, headerRow + 3).find((r) => r.some((c) => nfkc(c) === "名前"));
  const colOf = (label: string, fallback: number) => {
    const i = namesRow?.findIndex((c) => nfkc(c) === label) ?? -1;
    return i >= 0 ? i : fallback;
  };
  const rankCol = colOf("ランク", 0);
  const nameCol = colOf("名前", 1);
  const stationCol = colOf("最寄り駅", 2);

  // 「単価 / 現場 / 人数 / 場所 / シフト」が書いてある列
  const counts = new Map<number, number>();
  for (const r of rows.slice(headerRow + 1)) r.forEach((c, i) => LABELS.includes(nfkc(c)) && counts.set(i, (counts.get(i) ?? 0) + 1));
  const labelCol = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (labelCol == null) {
    return { month, days: dayCols.map((d) => d.day), clients: [], staff: [], warnings: ["「単価 / 現場 / 人数」「単価 / 場所 / シフト」の行が見つかりません"] };
  }
  const label = (r: number) => nfkc(rows[r]?.[labelCol]);

  const clients: SheetClient[] = [];
  const staff: SheetStaff[] = [];
  let current: SheetClient | null = null;

  for (let r = headerRow + 1; r < rows.length; r++) {
    if (label(r) !== "単価") continue;

    if (label(r + 1) === "現場" && label(r + 2) === "人数") {
      const name = rows[r].slice(0, labelCol).map((c) => c.trim()).find(Boolean);
      if (name) {
        current = clients.find((c) => c.name === name) ?? { name, lines: [] };
        if (!clients.includes(current)) clients.push(current);
      }
      for (const { col, day } of dayCols) {
        const venue = cell(rows, r + 1, col);
        if (!venue) continue;
        if (!current) {
          warnings.push(`${r + 2}行目: 取引先名がないので「${venue}」（${day}日）は取り込みません`);
          continue;
        }
        const n = Number.parseInt(nfkc(cell(rows, r + 2, col)), 10);
        if (!(n > 0)) warnings.push(`${current.name}「${venue}」${day}日: 人数が空欄・0 なので1人にしました`);
        const { amount, transport } = parseYen(cell(rows, r, col));
        current.lines.push({ day, venue, required: n > 0 ? n : 1, rate: amount != null && amount > 0 ? amount : null, transport });
      }
      r += 2;
      continue;
    }

    if (label(r + 1) === "場所" && label(r + 2) === "シフト") {
      const pick = (col: number) => [r, r + 1, r + 2].map((i) => cell(rows, i, col)).find(Boolean) ?? "";
      const name = pick(nameCol);
      const s: SheetStaff = { rank: pick(rankCol), name, station: pick(stationCol), places: [], shifts: [], rates: [] };
      for (const { col, day } of dayCols) {
        const place = cell(rows, r + 1, col);
        if (place) s.places.push({ day, place });
        const raw = cell(rows, r + 2, col);
        const shift = parseShift(raw);
        if (shift) s.shifts.push({ day, status: shift });
        else if (raw) warnings.push(`${name || `${r + 3}行目`} ${day}日: シフト「${raw}」は読めないので取り込みません`);
        const rateRaw = cell(rows, r, col);
        if (rateRaw) s.rates.push({ day, amount: parseYen(rateRaw).amount, raw: rateRaw });
      }
      if (name) staff.push(s);
      else if (s.places.length || s.shifts.length) warnings.push(`${r + 2}行目: 名前がないスタッフの行は取り込みません`);
      r += 2;
    }
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
