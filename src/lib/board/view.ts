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

/** この月に現場のある会場（現場の多い順 → 名前順）。会場のボタン（押すと同じ会場のマスが光る）に出す */
export type BoardVenue = { id: string; name: string; color: string; events: number };
export function venuesOf(board: Board): BoardVenue[] {
  const m = new Map<string, BoardVenue>();
  for (const c of board.clients)
    for (const chips of Object.values(c.cells))
      for (const e of chips) {
        if (e.cancelled) continue;
        const v = m.get(e.venueId) ?? { id: e.venueId, name: e.venueName, color: e.venueColor, events: 0 };
        v.events += 1;
        m.set(e.venueId, v);
      }
  return [...m.values()].sort((a, b) => b.events - a.events || a.name.localeCompare(b.name, "ja"));
}

/** 欠員のある現場のマスの数（「次の欠員へ」の件数） */
export function shortageTileCount(board: Board): number {
  return board.clients.reduce((n, c) => n + Object.values(c.cells).reduce((m, chips) => m + chips.filter(short).length, 0), 0);
}

/**
 * つながりの強調（Phase 17）: マスを押す・マウスを乗せると、同じ現場のマス（上の段の現場と下の段の人）が光り、
 * 同じ会場のマスには点線の枠、ほかは薄くなる。欠員の現場なら、その日○で空いている人も光る（打診の候補）。
 * マスが 2,000 以上あるので、マスごとに描き直さず CSS だけを差し替える（selectionCss と同じやり方）
 */
export type BoardLink = { event?: string; venue?: string; col?: number; short?: boolean };

export function linkCss(scope: string, l: BoardLink | null): string {
  if (!l || (!l.event && !l.venue)) return "";
  const S = `[data-board="${scope}"]`;
  const ring = "position: relative; z-index: 2; box-shadow: 0 0 0 2px var(--background), 0 0 0 5px var(--primary);";
  const head = (sel: string) => `${sel} { background-color: var(--brand-50); box-shadow: inset 4px 0 0 var(--primary); color: var(--primary); font-weight: 700; }`;
  const glow = (sel: string) => `@media (prefers-reduced-motion: no-preference) { ${sel} { animation: board-link 1.3s ease-in-out infinite; } }`;
  const out: string[] = [];
  if (l.event) {
    const X = `[data-event="${l.event}"]`;
    const V = l.venue ? `[data-venue="${l.venue}"]` : "";
    // 同じ現場は光り、同じ会場は点線の枠で残し、ほかは薄く
    out.push(`${S} [data-event]:not(${X})${V ? `:not(${V})` : ""} { opacity: 0.28; }`);
    // 同じ会場の点線は、塗りの上で見えるよう文字の色（白か濃い紺）で
    if (V) out.push(`${S} ${V}:not(${X}) { outline: 2px dashed var(--v-on); outline-offset: -3px; }`);
    out.push(`${S} ${X} { ${ring} }`, glow(`${S} ${X}`));
    out.push(head(`${S} tr:has(${X}) > th[data-c="0"]`));
    if (l.col != null) out.push(`${S} thead th[data-c="${l.col}"] { background-color: var(--brand-100); box-shadow: inset 0 -4px 0 var(--primary); }`);
    out.push(`${S} [data-avail] { opacity: 0.3; }`);
    if (l.short && l.col != null) {
      // 欠員の現場: その日○で空いている人（打診できる候補）を緑の枠で
      const ok = `${S} tr[data-kind="staff"] > td[data-c="${l.col}"] [data-avail="ok"]`;
      out.push(`${ok} { opacity: 1; box-shadow: 0 0 0 3px var(--status-done-solid); }`, glow(ok));
      out.push(head(`${S} tr[data-kind="staff"]:has(td[data-c="${l.col}"] [data-avail="ok"]) > th[data-c="0"]`));
    }
  } else if (l.venue) {
    const V = `[data-venue="${l.venue}"]`;
    out.push(`${S} [data-event]:not(${V}), ${S} [data-avail] { opacity: 0.28; }`);
    out.push(`${S} ${V} { ${ring} }`);
    out.push(head(`${S} tr:has(${V}) > th[data-c="0"]`));
  }
  return out.join("\n");
}
