/**
 * 稼働表（今の月のスプレッドシートと同じ形の一覧。Phase 1.5）。
 * - 上の段: 取引先 × 日付（その日の現場と、確定/必要人数・欠員）
 * - 下の段: スタッフ × 日付（確定・打診中の現場、稼働可能日の ○△×）
 *
 * DB から取った行を、画面・見るだけリンク・スプレッドシートへの書き出しで共通に使う形に組み立てる。
 * 金額は扱わない（共有にも使うため）。
 */
import { eachDay, monthRange, weekdayJa, type DateString } from "@/lib/date";

export type AvailabilityStatus = "ok" | "maybe" | "ng";
export type BoardAssignmentStatus = "offered" | "confirmed" | "waitlisted";

export type BoardEvent = {
  id: string;
  date: DateString;
  client_id: string;
  client_name: string;
  venue_id: string;
  venue_name: string;
  required_total: number;
  confirmed_total: number;
  shortage_total: number;
  offered_count: number;
  cancelled: boolean;
};

export type BoardStaff = {
  id: string;
  name: string;
  kana: string;
  rank_name: string | null;
  /** ランクの並び順（小さいほど上）。ランクなしは null */
  rank_order: number | null;
  nearest_station: string;
};

export type BoardAssignment = {
  id: string;
  event_id: string;
  staff_id: string;
  role_id: string;
  status: BoardAssignmentStatus;
};

export type BoardAvailability = { staff_id: string; date: DateString; status: AvailabilityStatus };

export type BoardInput = {
  /** YYYY-MM */
  month: string;
  today: DateString;
  holidays: Record<string, string>;
  events: BoardEvent[];
  staff: BoardStaff[];
  assignments: BoardAssignment[];
  availability: BoardAvailability[];
};

export type BoardDay = {
  date: DateString;
  day: number;
  weekday: string;
  holiday: string | null;
  isToday: boolean;
  /** 中止を除いた、その日の現場の合計 */
  required: number;
  confirmed: number;
  shortage: number;
};

export type BoardEventChip = {
  id: string;
  venueName: string;
  required: number;
  confirmed: number;
  shortage: number;
  offered: number;
  cancelled: boolean;
};

export type BoardClientRow = { id: string; name: string; cells: Record<string, BoardEventChip[]> };

export type BoardStaffAssignment = {
  id: string;
  eventId: string;
  roleId: string;
  venueName: string;
  clientName: string;
  status: BoardAssignmentStatus;
};

export type BoardStaffCell = { assignments: BoardStaffAssignment[]; availability: AvailabilityStatus | null };

export type BoardStaffRow = {
  id: string;
  name: string;
  rankName: string | null;
  station: string;
  cells: Record<string, BoardStaffCell>;
  /** 確定している稼働日数（中止の現場は除く） */
  workedDays: number;
};

export type Board = {
  month: string;
  days: BoardDay[];
  clients: BoardClientRow[];
  staff: BoardStaffRow[];
  /** 月の合計（中止を除く） */
  totals: { events: number; required: number; confirmed: number; shortage: number; workedDays: number };
};

const ja = (a: string, b: string) => a.localeCompare(b, "ja");

const STATUS_ORDER: Record<BoardAssignmentStatus, number> = { confirmed: 0, offered: 1, waitlisted: 2 };

export function buildBoard(input: BoardInput): Board {
  const { start, end } = monthRange(input.month);
  const inMonth = (d: string) => d >= start && d <= end;
  const events = input.events.filter((e) => inMonth(e.date));
  const eventById = new Map(events.map((e) => [e.id, e]));

  const days: BoardDay[] = eachDay(start, end).map((date) => {
    const live = events.filter((e) => e.date === date && !e.cancelled);
    return {
      date,
      day: Number(date.slice(8)),
      weekday: weekdayJa(date),
      holiday: input.holidays[date] ?? null,
      isToday: date === input.today,
      required: live.reduce((n, e) => n + e.required_total, 0),
      confirmed: live.reduce((n, e) => n + e.confirmed_total, 0),
      shortage: live.reduce((n, e) => n + e.shortage_total, 0),
    };
  });

  // 上の段: 現場のある取引先だけ（名前順）
  const clientMap = new Map<string, BoardClientRow>();
  for (const e of [...events].sort((a, b) => ja(a.venue_name, b.venue_name))) {
    const row = clientMap.get(e.client_id) ?? { id: e.client_id, name: e.client_name, cells: {} };
    (row.cells[e.date] ??= []).push({
      id: e.id,
      venueName: e.venue_name,
      required: e.required_total,
      confirmed: e.confirmed_total,
      shortage: e.cancelled ? 0 : e.shortage_total,
      offered: e.offered_count,
      cancelled: e.cancelled,
    });
    clientMap.set(e.client_id, row);
  }
  const clients = [...clientMap.values()].sort((a, b) => ja(a.name, b.name));

  // 下の段: ランク順 → かな順
  const availability = new Map(input.availability.filter((a) => inMonth(a.date)).map((a) => [`${a.staff_id}|${a.date}`, a.status]));
  const asgByStaffDate = new Map<string, BoardStaffAssignment[]>();
  for (const a of input.assignments) {
    const e = eventById.get(a.event_id);
    if (!e || e.cancelled) continue;
    const key = `${a.staff_id}|${e.date}`;
    asgByStaffDate.set(key, [
      ...(asgByStaffDate.get(key) ?? []),
      { id: a.id, eventId: e.id, roleId: a.role_id, venueName: e.venue_name, clientName: e.client_name, status: a.status },
    ]);
  }
  const staff = [...input.staff]
    .sort((a, b) => (a.rank_order ?? Number.MAX_SAFE_INTEGER) - (b.rank_order ?? Number.MAX_SAFE_INTEGER) || ja(a.kana || a.name, b.kana || b.name))
    .map((s): BoardStaffRow => {
      const cells: Record<string, BoardStaffCell> = {};
      let workedDays = 0;
      for (const d of days) {
        const asg = (asgByStaffDate.get(`${s.id}|${d.date}`) ?? []).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
        if (asg.some((a) => a.status === "confirmed")) workedDays++;
        cells[d.date] = { assignments: asg, availability: availability.get(`${s.id}|${d.date}`) ?? null };
      }
      return { id: s.id, name: s.name, rankName: s.rank_name, station: s.nearest_station, cells, workedDays };
    });

  const live = events.filter((e) => !e.cancelled);
  return {
    month: input.month,
    days,
    clients,
    staff,
    totals: {
      events: live.length,
      required: live.reduce((n, e) => n + e.required_total, 0),
      confirmed: live.reduce((n, e) => n + e.confirmed_total, 0),
      shortage: live.reduce((n, e) => n + e.shortage_total, 0),
      workedDays: staff.reduce((n, s) => n + s.workedDays, 0),
    },
  };
}

/** ○△× の表示（今のシートの ⭕️🔺❌ に合わせる） */
export const AVAILABILITY_MARK: Record<AvailabilityStatus, string> = { ok: "○", maybe: "△", ng: "×" };
