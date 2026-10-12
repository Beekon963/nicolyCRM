/**
 * 稼働表の見せ方（Phase 10）: 絞り込み・○で空いている人・人数分のマス。
 * 画面（表・スマホのリスト）で共通に使う。データは変えず、見せる行・列だけを選ぶ
 */
import { type Fill, fillOf } from "@/lib/fill";
import { type Board, type BoardDay, type BoardEventChip, type BoardStaffCell, isDropped } from "./index";

export type BoardFilters = {
  /** 欠員のある現場だけ（そろった・中止の現場と、欠員のない取引先の行を隠す） */
  shortageOnly: boolean;
  /** ○を出していて、その日まだ予定のない人だけ（いま打診できる人） */
  freeOnly: boolean;
  /** 今日から先だけ（今の月のとき、過ぎた日を隠す） */
  fromToday: boolean;
};

export const NO_FILTERS: BoardFilters = { shortageOnly: false, freeOnly: false, fromToday: false };

/** ○で、その日まだ予定がない（打診中・補欠・確定がない。キャンセル・当日不稼働になった分は数えない） */
export function isFree(cell: BoardStaffCell | undefined): boolean {
  return cell?.availability === "ok" && !cell.assignments.some((a) => !isDropped(a.status));
}

/** 日ごとの「○で空いている人」の数 */
export function freeCountByDate(board: Board): Record<string, number> {
  return Object.fromEntries(board.days.map((d) => [d.date, board.staff.filter((s) => isFree(s.cells[d.date])).length]));
}

/** 今の月で、今日より前の日があるか（「今日から先だけ」を出すか） */
export function pastDayCount(board: Board): number {
  const i = board.days.findIndex((d) => d.isToday);
  return i > 0 ? i : 0;
}

const shown = (board: Board, f: Pick<BoardFilters, "fromToday">): BoardDay[] => {
  const i = board.days.findIndex((d) => d.isToday);
  return f.fromToday && i > 0 ? board.days.slice(i) : board.days;
};

const short = (e: BoardEventChip) => !e.cancelled && e.shortage > 0;

/** 絞り込んだ稼働表（行と日だけを選ぶ。合計の数字はそのまま） */
export function filterBoard(board: Board, f: BoardFilters): Board {
  if (!f.shortageOnly && !f.freeOnly && !f.fromToday) return board;
  const days = shown(board, f);
  const clients = f.shortageOnly
    ? board.clients
        .map((c) => ({ ...c, cells: Object.fromEntries(days.map((d) => [d.date, (c.cells[d.date] ?? []).filter(short)])) }))
        .filter((c) => days.some((d) => c.cells[d.date].length > 0))
    : board.clients;
  const staff = f.freeOnly ? board.staff.filter((s) => days.some((d) => isFree(s.cells[d.date]))) : board.staff;
  return { ...board, days, clients, staff };
}

/** 絞り込みのボタンに出す件数（今日から先だけにしているときは、その日の分だけ数える） */
export function filterCounts(board: Board, f: Pick<BoardFilters, "fromToday">): { shortage: number; free: number; past: number } {
  const days = shown(board, f);
  return {
    shortage: board.clients.reduce((n, c) => n + days.reduce((m, d) => m + (c.cells[d.date] ?? []).filter(short).length, 0), 0),
    free: board.staff.filter((s) => days.some((d) => isFree(s.cells[d.date]))).length,
    past: pastDayCount(board),
  };
}

export type Seat = "filled" | "offered" | "empty";

/** 人数分のマス: 確定 → 打診中（縞）→ 空き の順に並べる（必要人数より多い確定・打診中は数えない） */
export function seatsOf(e: { required: number; confirmed: number; offered: number }): Seat[] {
  const required = Math.max(0, e.required);
  const filled = Math.min(required, Math.max(0, e.confirmed));
  const offered = Math.min(required - filled, Math.max(0, e.offered));
  return [...Array<Seat>(filled).fill("filled"), ...Array<Seat>(offered).fill("offered"), ...Array<Seat>(required - filled - offered).fill("empty")];
}

/** マスの中の現場の並び: 欠員のある現場を先に、中止はあとに（あふれて隠れるのは、そろった現場から） */
export function sortChips(chips: BoardEventChip[]): BoardEventChip[] {
  const rank = (e: BoardEventChip) => (e.cancelled ? 2 : short(e) ? 0 : 1);
  return [...chips].sort((a, b) => rank(a) - rank(b));
}

/** 取引先の行の埋まり具合（見えている日の、中止を除いた現場） */
export function clientFill(cells: Record<string, BoardEventChip[]>, days: BoardDay[]): Fill {
  return fillOf(days.flatMap((d) => (cells[d.date] ?? []).filter((e) => !e.cancelled)));
}
