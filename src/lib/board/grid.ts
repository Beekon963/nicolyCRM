/**
 * 稼働表をスプレッドシートのように扱うための決まりごと（マスの選択・移動・コピー・○△× の入力）。
 * 画面に依存しない形にして、テストで確かめる。金額は扱わない（稼働表に金額は入っていない）。
 *
 * マスの番地: 行 r は gridRows() の順（0 = 日付の行）、列 c は 0 = 名前、1〜日数 = 各日、最後 = 稼働日数。
 */
import { AVAILABILITY_MARK, type AvailabilityStatus, type Board } from "./index";

export type GridRow = { kind: "header" } | { kind: "shortage" } | { kind: "client"; id: string } | { kind: "staff"; id: string };
export type Pos = { r: number; c: number };
export type Selection = { anchor: Pos; focus: Pos };
export type Range = { r1: number; r2: number; c1: number; c2: number };

/** 表に並ぶ行（見出しの「現場（取引先ごと）」「スタッフ」の行は選べないので入れない） */
export function gridRows(board: Board): GridRow[] {
  const rows: GridRow[] = [{ kind: "header" }];
  if (board.clients.length) {
    rows.push({ kind: "shortage" });
    for (const c of board.clients) rows.push({ kind: "client", id: c.id });
  }
  for (const s of board.staff) rows.push({ kind: "staff", id: s.id });
  return rows;
}

/** 列の数（名前 ＋ 日数 ＋ 稼働日数） */
export function gridColCount(board: Board) {
  return board.days.length + 2;
}

export function rowKey(row: GridRow) {
  return row.kind === "client" || row.kind === "staff" ? `${row.kind}:${row.id}` : row.kind;
}

export function single(p: Pos): Selection {
  return { anchor: p, focus: p };
}

export function normRange(sel: Selection): Range {
  return {
    r1: Math.min(sel.anchor.r, sel.focus.r),
    r2: Math.max(sel.anchor.r, sel.focus.r),
    c1: Math.min(sel.anchor.c, sel.focus.c),
    c2: Math.max(sel.anchor.c, sel.focus.c),
  };
}

export function clampPos(p: Pos, rows: number, cols: number): Pos {
  return { r: Math.min(rows - 1, Math.max(0, p.r)), c: Math.min(cols - 1, Math.max(0, p.c)) };
}

export type MoveKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End" | "PageUp" | "PageDown";
export const MOVE_KEYS: readonly string[] = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"];

/**
 * キーでの移動（スプレッドシートと同じ）。shift なら範囲を広げる、jump（Ctrl / ⌘）なら端まで飛ぶ。
 * Home / End は行の最初・最後、PageUp / PageDown は 10 行ずつ。
 */
export function moveSelection(sel: Selection, key: MoveKey, o: { shift?: boolean; jump?: boolean; rows: number; cols: number }): Selection {
  const { r, c } = sel.focus;
  const page = 10;
  let next: Pos;
  switch (key) {
    case "ArrowUp":
      next = { r: o.jump ? 0 : r - 1, c };
      break;
    case "ArrowDown":
      next = { r: o.jump ? o.rows - 1 : r + 1, c };
      break;
    case "ArrowLeft":
      next = { r, c: o.jump ? 0 : c - 1 };
      break;
    case "ArrowRight":
      next = { r, c: o.jump ? o.cols - 1 : c + 1 };
      break;
    case "Home":
      next = o.jump ? { r: 0, c: 0 } : { r, c: 0 };
      break;
    case "End":
      next = o.jump ? { r: o.rows - 1, c: o.cols - 1 } : { r, c: o.cols - 1 };
      break;
    case "PageUp":
      next = { r: r - page, c };
      break;
    case "PageDown":
      next = { r: r + page, c };
      break;
  }
  const focus = clampPos(next, o.rows, o.cols);
  return o.shift ? { anchor: sel.anchor, focus } : single(focus);
}

/** 1つのマスの文字（コピー用。画面に出ているものと同じ言葉） */
export function cellText(board: Board, row: GridRow, c: number): string {
  const n = board.days.length;
  const day = c >= 1 && c <= n ? board.days[c - 1] : null;
  switch (row.kind) {
    case "header":
      if (c === 0) return "日付";
      if (day) return `${day.day}(${day.weekday})`;
      return "稼働日数";
    case "shortage":
      if (c === 0) return "欠員";
      if (day) return day.shortage > 0 ? `${day.shortage}人` : day.required > 0 ? "0" : "";
      return board.totals.shortage > 0 ? String(board.totals.shortage) : "";
    case "client": {
      const cl = board.clients.find((x) => x.id === row.id);
      if (!cl) return "";
      if (c === 0) return cl.name;
      if (!day) return "";
      return (cl.cells[day.date] ?? []).map((e) => `${e.venueName} ${e.cancelled ? "中止" : `${e.confirmed}/${e.required}`}`).join(" / ");
    }
    case "staff": {
      const s = board.staff.find((x) => x.id === row.id);
      if (!s) return "";
      if (c === 0) return s.name;
      if (!day) return s.workedDays ? String(s.workedDays) : "";
      const cell = s.cells[day.date];
      if (!cell) return "";
      if (cell.assignments.length) {
        return cell.assignments.map((a) => `${a.status === "offered" ? "打 " : a.status === "waitlisted" ? "補 " : ""}${a.venueName}`).join(" / ");
      }
      return cell.availability ? AVAILABILITY_MARK[cell.availability] : "";
    }
  }
}

function tsvCell(text: string) {
  return /[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 選んだ範囲をタブ区切りの文字にする（スプレッドシートや LINE に貼り付けられる） */
export function selectionTsv(board: Board, rows: GridRow[], sel: Selection): string {
  const { r1, r2, c1, c2 } = normRange(sel);
  const lines: string[] = [];
  for (let r = r1; r <= r2; r++) {
    const cells: string[] = [];
    for (let c = c1; c <= c2; c++) cells.push(tsvCell(cellText(board, rows[r], c)));
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

/** キー → 稼働可能日（1 / o = ○、2 = △、3 / x = ×、Delete / Backspace = 未入力）。当てはまらなければ undefined */
export function availabilityFromKey(key: string): AvailabilityStatus | null | undefined {
  switch (key) {
    case "1":
    case "o":
    case "O":
    case "○":
    case "〇":
      return "ok";
    case "2":
    case "△":
      return "maybe";
    case "3":
    case "x":
    case "X":
    case "×":
      return "ng";
    case "Delete":
    case "Backspace":
      return null;
    default:
      return undefined;
  }
}

export type AvailabilityChange = { staffId: string; date: string; status: AvailabilityStatus | null; previous: AvailabilityStatus | null };

/** 選んだ範囲のスタッフ × 日のマスに、稼働可能日を入れたときの変更（もともと同じ値のマスは除く） */
export function availabilityChanges(board: Board, rows: GridRow[], sel: Selection, status: AvailabilityStatus | null): AvailabilityChange[] {
  const { r1, r2, c1, c2 } = normRange(sel);
  const out: AvailabilityChange[] = [];
  for (let r = r1; r <= r2; r++) {
    const row = rows[r];
    if (row?.kind !== "staff") continue;
    const s = board.staff.find((x) => x.id === row.id);
    if (!s) continue;
    for (let c = Math.max(1, c1); c <= Math.min(board.days.length, c2); c++) {
      const date = board.days[c - 1].date;
      const previous = s.cells[date]?.availability ?? null;
      if (previous !== status) out.push({ staffId: s.id, date, status, previous });
    }
  }
  return out;
}

/** 「元に戻す」用: 変更を逆向きにする */
export function reverseChanges(changes: AvailabilityChange[]): AvailabilityChange[] {
  return changes.map((ch) => ({ ...ch, status: ch.previous, previous: ch.status }));
}

/** 画面にすぐ反映するため、稼働可能日の変更を稼働表に当てはめる（保存が終わるまでの仮の表示） */
export function applyAvailability(board: Board, changes: Pick<AvailabilityChange, "staffId" | "date" | "status">[]): Board {
  if (!changes.length) return board;
  const byStaff = new Map<string, Map<string, AvailabilityStatus | null>>();
  for (const ch of changes) {
    const m = byStaff.get(ch.staffId) ?? new Map();
    m.set(ch.date, ch.status);
    byStaff.set(ch.staffId, m);
  }
  return {
    ...board,
    staff: board.staff.map((s) => {
      const m = byStaff.get(s.id);
      if (!m) return s;
      const cells = { ...s.cells };
      for (const [date, status] of m) cells[date] = { assignments: cells[date]?.assignments ?? [], availability: status };
      return { ...s, cells };
    }),
  };
}

/** 列の幅・行の高さ（スプレッドシートのように変えられる。端末に覚えておく） */
export const DAY_WIDTH = { min: 40, max: 240 } as const;
export const NAME_WIDTH = { min: 64, max: 320 } as const;
export function clampWidth(px: number, range: { min: number; max: number }) {
  return Math.round(Math.min(range.max, Math.max(range.min, px)));
}

export type RowDensity = "small" | "normal" | "large";
/** 行の高さ（px）と、会場名を何行まで出すか */
export const ROW_DENSITY: Record<RowDensity, { label: string; height: number; lines: number }> = {
  small: { label: "小", height: 28, lines: 1 },
  normal: { label: "中", height: 44, lines: 2 },
  large: { label: "大", height: 64, lines: 3 },
};
export function nextDensity(d: RowDensity): RowDensity {
  return d === "normal" ? "small" : d === "small" ? "large" : "normal";
}
