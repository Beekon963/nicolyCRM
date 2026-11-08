/**
 * 稼働表（今の月のスプレッドシートと同じ形の一覧。Phase 1.5）。
 * - 上の段: 取引先 × 日付（その日の現場と、確定/必要人数・欠員）
 * - 下の段: スタッフ × 日付（確定・打診中の現場、キャンセル・当日不稼働になった現場、稼働可能日の ○△×）
 * - 現場のマスとスタッフのマスは、会場の色でそろえる（Phase 6）
 *
 * DB から取った行を、画面・見るだけリンク・スプレッドシートへの書き出しで共通に使う形に組み立てる。
 * 金額は扱わない（共有にも使うため）。
 */
import { eachDay, monthRange, weekdayJa, type DateString } from "@/lib/date";

export type AvailabilityStatus = "ok" | "maybe" | "ng";
export type BoardAssignmentStatus = "offered" | "confirmed" | "waitlisted" | "cancelled" | "no_show";

export type BoardEvent = {
  id: string;
  date: DateString;
  client_id: string;
  client_name: string;
  venue_id: string;
  venue_name: string;
  /** 会場の色（src/lib/venue-colors.ts のキー） */
  venue_color?: string;
  /** 稼働表のチップに出す短い名前の元（Phase 22）: 会場の「場所の短い名前」と取引先の「扱うキャリア」。見るだけリンクでは空 */
  venue_short?: string;
  carrier?: string;
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
  /**
   * 月の前後の日も持つとき（Phase 22-4。週ビューで月をまたぐ週を出すため）: 月の最初の週の月曜〜最後の週の日曜。
   * この範囲の現場・予定・○△× を events / assignments / availability に入れておく。日付の並び（days）・合計・表には入れない
   */
  pad?: { start: DateString; end: DateString };
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
  venueId: string;
  venueName: string;
  venueColor: string;
  /** 場所の短い名前（空なら会場名から作る。src/lib/board/short-name.ts） */
  venueShort: string;
  /** 取引先の扱うキャリア（空 = 未設定） */
  carrier: string;
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
  venueId: string;
  venueName: string;
  venueColor: string;
  venueShort: string;
  carrier: string;
  clientName: string;
  status: BoardAssignmentStatus;
};

export type BoardStaffCell = { assignments: BoardStaffAssignment[]; availability: AvailabilityStatus | null };

export type BoardStaffRow = {
  id: string;
  name: string;
  /** ふりがな（名前で探すとき用。Phase 22） */
  kana: string;
  rankName: string | null;
  station: string;
  cells: Record<string, BoardStaffCell>;
  /** 確定している稼働日数（中止の現場は除く） */
  workedDays: number;
};

export type Board = {
  month: string;
  days: BoardDay[];
  /** 月の前後の日（週ビュー用。pad を渡したときだけ。日付順） */
  pad: BoardDay[];
  clients: BoardClientRow[];
  staff: BoardStaffRow[];
  /** 月の合計（中止を除く） */
  totals: { events: number; required: number; confirmed: number; shortage: number; workedDays: number };
};

const ja = (a: string, b: string) => a.localeCompare(b, "ja");

const STATUS_ORDER: Record<BoardAssignmentStatus, number> = { confirmed: 0, offered: 1, waitlisted: 2, no_show: 3, cancelled: 4 };

/** 確定していた人が来られなくなった（マスを赤くする） */
export function isDropped(status: BoardAssignmentStatus) {
  return status === "cancelled" || status === "no_show";
}

export function buildBoard(input: BoardInput): Board {
  const { start, end } = monthRange(input.month);
  const rangeStart = input.pad && input.pad.start < start ? input.pad.start : start;
  const rangeEnd = input.pad && input.pad.end > end ? input.pad.end : end;
  const inMonth = (d: string) => d >= start && d <= end;
  const inRange = (d: string) => d >= rangeStart && d <= rangeEnd;
  const events = input.events.filter((e) => inRange(e.date));
  const eventById = new Map(events.map((e) => [e.id, e]));

  const dayOf = (date: DateString): BoardDay => {
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
  };
  const allDates = eachDay(rangeStart, rangeEnd);
  const days = eachDay(start, end).map(dayOf);
  const pad = allDates.filter((d) => !inMonth(d)).map(dayOf);

  // 上の段: この月に現場のある取引先だけ（名前順）。前後の日の現場は、その取引先の行のマスにだけ入れる
  const sorted = [...events].sort((a, b) => ja(a.venue_name, b.venue_name));
  const clientMap = new Map<string, BoardClientRow>();
  for (const e of sorted) if (inMonth(e.date) && !clientMap.has(e.client_id)) clientMap.set(e.client_id, { id: e.client_id, name: e.client_name, cells: {} });
  for (const e of sorted) {
    const row = clientMap.get(e.client_id);
    if (!row) continue;
    (row.cells[e.date] ??= []).push({
      id: e.id,
      venueId: e.venue_id,
      venueName: e.venue_name,
      venueColor: e.venue_color ?? "",
      venueShort: e.venue_short ?? "",
      carrier: e.carrier ?? "",
      required: e.required_total,
      confirmed: e.confirmed_total,
      shortage: e.cancelled ? 0 : e.shortage_total,
      offered: e.offered_count,
      cancelled: e.cancelled,
    });
  }
  const clients = [...clientMap.values()].sort((a, b) => ja(a.name, b.name));

  // 下の段: ランク順 → かな順
  const availability = new Map(input.availability.filter((a) => inRange(a.date)).map((a) => [`${a.staff_id}|${a.date}`, a.status]));
  const asgByStaffDate = new Map<string, BoardStaffAssignment[]>();
  for (const a of input.assignments) {
    const e = eventById.get(a.event_id);
    if (!e || e.cancelled) continue;
    const key = `${a.staff_id}|${e.date}`;
    asgByStaffDate.set(key, [
      ...(asgByStaffDate.get(key) ?? []),
      {
        id: a.id,
        eventId: e.id,
        roleId: a.role_id,
        venueId: e.venue_id,
        venueName: e.venue_name,
        venueColor: e.venue_color ?? "",
        venueShort: e.venue_short ?? "",
        carrier: e.carrier ?? "",
        clientName: e.client_name,
        status: a.status,
      },
    ]);
  }
  const staff = [...input.staff]
    .sort((a, b) => (a.rank_order ?? Number.MAX_SAFE_INTEGER) - (b.rank_order ?? Number.MAX_SAFE_INTEGER) || ja(a.kana || a.name, b.kana || b.name))
    .map((s): BoardStaffRow => {
      const cells: Record<string, BoardStaffCell> = {};
      let workedDays = 0;
      for (const date of allDates) {
        const asg = (asgByStaffDate.get(`${s.id}|${date}`) ?? []).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
        // 稼働日数はこの月の分だけ
        if (inMonth(date) && asg.some((a) => a.status === "confirmed")) workedDays++;
        cells[date] = { assignments: asg, availability: availability.get(`${s.id}|${date}`) ?? null };
      }
      return { id: s.id, name: s.name, kana: s.kana, rankName: s.rank_name, station: s.nearest_station, cells, workedDays };
    });

  // 合計はこの月の分だけ（中止を除く）
  const live = events.filter((e) => !e.cancelled && inMonth(e.date));
  return {
    month: input.month,
    days,
    pad,
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
