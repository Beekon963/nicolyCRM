/**
 * 稼働表の新しい見せ方（Phase 22。日・週・月のタブ）で使う、画面に依存しない計算。
 * - マスの見せ方は「状態は形、現場は色」: 確定 = 会場の色で塗る、仮（打診中・補欠）= 点線の枠、現場未定 = 橙の枠、× = 空白
 * - 「現場未定」= ○か△があって、その日に生きた予定（打診中・確定・補欠）がない人（view.ts の isFree と同じ考え方。△も数える）
 * - 週は月曜はじまりの7日
 */
import { addDays, type DateString, eachDay } from "@/lib/date";
import { searchNorm } from "@/lib/search";
import { type Board, type BoardEventChip, type BoardStaffAssignment, type BoardStaffCell, type BoardStaffRow, isDropped } from "./index";

export type BoardTab = "day" | "week" | "month" | "table";
export const BOARD_TABS: { key: BoardTab; label: string; help: string }[] = [
  { key: "day", label: "日", help: "1日ずつ。現場未定の人が上に出ます" },
  { key: "week", label: "週", help: "人 × 7日" },
  { key: "month", label: "月", help: "稼働日数のヒートマップ" },
  { key: "table", label: "表", help: "今までの月の表（キー入力・拡大・コピー）" },
];

export function isBoardTab(v: unknown): v is BoardTab {
  return v === "day" || v === "week" || v === "month" || v === "table";
}

/** 端末に覚えた見せ方（新しいキー → 古い「リスト／表」のキーの順に読む） */
export function tabFromPrefs(tabRaw: string | null, legacyRaw: string | null): BoardTab | null {
  const parse = (raw: string | null): unknown => {
    try {
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  const t = parse(tabRaw);
  if (isBoardTab(t)) return t;
  const legacy = parse(legacyRaw);
  if (legacy === "list") return "day";
  if (legacy === "table") return "table";
  return null;
}

/** マスに出すもの（状態は形で区別する） */
export type ChipState =
  | { kind: "confirmed"; a: BoardStaffAssignment }
  /** 打診中・補欠 */
  | { kind: "tentative"; a: BoardStaffAssignment }
  /** キャンセル・当日不稼働（赤い枠。要対応） */
  | { kind: "dropped"; a: BoardStaffAssignment }
  /** ○か△があって、その日の現場が決まっていない */
  | { kind: "unassigned"; availability: "ok" | "maybe" }
  /** ×（空白で出す） */
  | { kind: "off" }
  | { kind: "empty" };

export function chipsOf(cell: BoardStaffCell | undefined): ChipState[] {
  if (!cell) return [{ kind: "empty" }];
  const out: ChipState[] = [];
  for (const a of cell.assignments) {
    if (isDropped(a.status)) out.push({ kind: "dropped", a });
    else out.push(a.status === "confirmed" ? { kind: "confirmed", a } : { kind: "tentative", a });
  }
  // 確定 → 仮 → 取り消し の順
  const rank = (c: ChipState) => (c.kind === "confirmed" ? 0 : c.kind === "tentative" ? 1 : 2);
  out.sort((x, y) => rank(x) - rank(y));
  if (out.length) return out;
  if (cell.availability === "ok" || cell.availability === "maybe") return [{ kind: "unassigned", availability: cell.availability }];
  if (cell.availability === "ng") return [{ kind: "off" }];
  return [{ kind: "empty" }];
}

/** その日「現場未定」か（○か△で、生きた予定がない） */
export function isUnassigned(cell: BoardStaffCell | undefined): cell is BoardStaffCell & { availability: "ok" | "maybe" } {
  return chipsOf(cell)[0]?.kind === "unassigned";
}

/** その日の現場未定の人（○の人が先、△はあと。ほかは稼働表の並びのまま） */
export function unassignedStaff(board: Board, date: DateString): { row: BoardStaffRow; availability: "ok" | "maybe" }[] {
  const out: { row: BoardStaffRow; availability: "ok" | "maybe" }[] = [];
  for (const row of board.staff) {
    const cell = row.cells[date];
    if (isUnassigned(cell)) out.push({ row, availability: cell.availability });
  }
  return out.sort((x, y) => (x.availability === y.availability ? 0 : x.availability === "ok" ? -1 : 1));
}

/** 月曜はじまりの7日（date を含む週） */
export function weekDates(date: DateString): DateString[] {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = 日
  const start = addDays(date, -((dow + 6) % 7));
  return eachDay(start, addDays(start, 6));
}

/** 最初に出す週: 今日がこの月なら今日の週、そうでなければ月の最初の週 */
export function initialWeek(board: Board): DateString[] {
  const today = board.days.find((d) => d.isToday);
  return weekDates(today?.date ?? board.days[0]?.date ?? (`${board.month}-01` as DateString));
}

/** 日ごとの 配置／必要（中止を除く）。月の外の日は null */
export function dayTotal(board: Board, date: DateString): { confirmed: number; required: number; shortage: number } | null {
  const d = board.days.find((x) => x.date === date);
  return d ? { confirmed: d.confirmed, required: d.required, shortage: d.shortage } : null;
}

const STATUS_ORDER = { confirmed: 0, offered: 1, waitlisted: 2, cancelled: 3, no_show: 4 } as const;

/** その現場に入っている人（確定 → 打診中 → 補欠 → 取り消し の順） */
export function eventStaff(board: Board, eventId: string, date: DateString): { row: BoardStaffRow; a: BoardStaffAssignment }[] {
  const out: { row: BoardStaffRow; a: BoardStaffAssignment }[] = [];
  for (const row of board.staff) for (const a of row.cells[date]?.assignments ?? []) if (a.eventId === eventId) out.push({ row, a });
  return out.sort((x, y) => STATUS_ORDER[x.a.status] - STATUS_ORDER[y.a.status]);
}

/** 新しいタブの絞り込み: 現場未定だけ・現場別（会場）・名前 */
export type StaffFilter = { unassignedOnly: boolean; venueId: string | null; query: string };
export const NO_STAFF_FILTER: StaffFilter = { unassignedOnly: false, venueId: null, query: "" };

/** 名前・ふりがな・最寄り駅が query に合うか（ひらがな・カタカナ・空白の違いは無視。空なら全員） */
export function staffMatches(row: BoardStaffRow, query: string): boolean {
  const q = searchNorm(query);
  return !q || searchNorm(row.name).includes(q) || searchNorm(row.kana).includes(q) || searchNorm(row.station).includes(q);
}

/** スタッフの行だけを選ぶ（見ている日の範囲 dates で判定。日は変えない） */
export function filterStaff(rows: BoardStaffRow[], f: StaffFilter, dates: DateString[]): BoardStaffRow[] {
  return rows.filter((row) => {
    if (!staffMatches(row, f.query)) return false;
    if (f.unassignedOnly && !dates.some((d) => isUnassigned(row.cells[d]))) return false;
    if (f.venueId && !dates.some((d) => (row.cells[d]?.assignments ?? []).some((a) => a.venueId === f.venueId && !isDropped(a.status)))) return false;
    return true;
  });
}

/** 見ている日の範囲で、現場未定の人の数（絞り込みボタンの件数） */
export function unassignedCount(rows: BoardStaffRow[], dates: DateString[]): number {
  return rows.filter((row) => dates.some((d) => isUnassigned(row.cells[d]))).length;
}

/** 日ビューの現場カード（Phase 22-3）: 現場のマスの情報に、取引先と入っている人を足したもの */
export type DayCard = BoardEventChip & { clientId: string; clientName: string; staff: { row: BoardStaffRow; a: BoardStaffAssignment }[] };

/** その日の現場（欠員 → そろった → 中止 の順。同じ組の中は会場名順） */
export function eventsOfDay(board: Board, date: DateString): DayCard[] {
  const out: DayCard[] = [];
  for (const c of board.clients) for (const e of c.cells[date] ?? []) out.push({ ...e, clientId: c.id, clientName: c.name, staff: eventStaff(board, e.id, date) });
  const rank = (e: DayCard) => (e.cancelled ? 2 : e.shortage > 0 ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || a.venueName.localeCompare(b.venueName, "ja"));
}

/** 最初に出す日: 指定の日（この月の中なら）→ 今日（この月なら）→ 月の最初の日 */
export function initialDate(board: Board, requested?: string | null): DateString {
  if (requested && board.days.some((d) => d.date === requested)) return requested;
  return board.days.find((d) => d.isToday)?.date ?? board.days[0]?.date ?? (`${board.month}-01` as DateString);
}

/** 日ビューの現場カードの絞り込み: 現場未定だけ = 欠員のある現場だけ（入れる先）、現場別 = その会場、名前 = その人が入っている現場 */
export function filterDayCards(cards: DayCard[], f: StaffFilter): DayCard[] {
  return cards.filter((c) => {
    if (f.venueId && c.venueId !== f.venueId) return false;
    if (f.unassignedOnly && (c.cancelled || c.shortage <= 0)) return false;
    if (searchNorm(f.query) && !c.staff.some(({ row }) => staffMatches(row, f.query))) return false;
    return true;
  });
}
