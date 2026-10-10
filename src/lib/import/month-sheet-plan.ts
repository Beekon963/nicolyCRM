/**
 * 月のシートの取り込み計画（Phase 1.5）。読んだシートを CRM の取引先・会場・スタッフ・現場と突き合わせ、
 * 何を作るかを決める。画面の確認（プレビュー）と、サーバーでの取り込みの両方で同じ計算を使う。
 *
 * - 過去の日の現場は「記録のみ」（実績報告なし）で作る。ホームや報告画面に「未報告」として出さないため
 * - 名簿にいない人は取り込まない（名簿は「スタッフ名簿」の取り込みで先に入れる）
 * - 上の段にない場所（研修など）は、取引先を選んだときだけ現場として作る
 */
import { companyKey, searchNorm } from "@/lib/search";
import type { ParsedMonthSheet, SheetShift } from "./month-sheet";

export type PlanContext = {
  today: string;
  clients: { id: string; name: string }[];
  venues: { id: string; name: string }[];
  staff: { id: string; name: string }[];
  /** その月の CRM の現場（中止は除く） */
  events: { id: string; date: string; client_id: string; venue_id: string }[];
};

export const NEW = "new";
export const SKIP = "skip";

export type PlanChoices = {
  /** YYYY-MM */
  month: string;
  /** シートの取引先名 → 取引先の id か NEW */
  clients: Record<string, string>;
  /** シートの会場名 → 会場の id か NEW */
  venues: Record<string, string>;
  /** シートの名前 → スタッフの id か SKIP */
  staff: Record<string, string>;
  /** 上の段にない場所 → 取引先の id か SKIP */
  places: Record<string, string>;
};

export type Ref = { id: string } | { newName: string };

export type PlanEvent = {
  key: string;
  date: string;
  client: Ref;
  venue: Ref;
  clientName: string;
  venueName: string;
  required: number;
  /** 請求の人日単価（オーナーだけが取り込む） */
  rate: number | null;
  existingId: string | null;
  /** 過去の日（実績報告なし） */
  recordOnly: boolean;
};

export type MonthSheetPlan = {
  newClients: string[];
  newVenues: string[];
  events: PlanEvent[];
  assignments: { eventKey: string; staffId: string; dailyRate: number | null }[];
  availability: { staffId: string; date: string; status: SheetShift }[];
  /** 「交通費別」の書き方があった取引先 */
  transportClients: Ref[];
  /** 上の段にない場所と、その日 */
  unknownPlaces: { place: string; days: number[] }[];
  notes: string[];
};

const staffKey = (name: string) => searchNorm(name);
const pad = (n: number) => String(n).padStart(2, "0");
const refKey = (r: Ref) => ("id" in r ? r.id : `new:${searchNorm(r.newName)}`);

/** 名前が同じものを自動で選ぶ（会社名は「株式会社」などの違いを無視） */
export function defaultChoices(parsed: ParsedMonthSheet, ctx: PlanContext, month: string): PlanChoices {
  const clients: Record<string, string> = {};
  for (const c of parsed.clients) clients[c.name] = ctx.clients.find((x) => companyKey(x.name) === companyKey(c.name))?.id ?? NEW;

  const topVenues = new Set(parsed.clients.flatMap((c) => c.lines.map((l) => l.venue)));
  const venues: Record<string, string> = {};
  for (const v of topVenues) venues[v] = ctx.venues.find((x) => searchNorm(x.name) === searchNorm(v))?.id ?? NEW;

  const staff: Record<string, string> = {};
  for (const s of parsed.staff) staff[s.name] = ctx.staff.find((x) => staffKey(x.name) === staffKey(s.name))?.id ?? SKIP;

  const places: Record<string, string> = {};
  const draft = buildPlan(parsed, ctx, { month, clients, venues, staff, places: {} });
  for (const u of draft.unknownPlaces) {
    places[u.place] = SKIP;
    venues[u.place] ??= ctx.venues.find((x) => searchNorm(x.name) === searchNorm(u.place))?.id ?? NEW;
  }
  return { month, clients, venues, staff, places };
}

export function buildPlan(parsed: ParsedMonthSheet, ctx: PlanContext, ch: PlanChoices): MonthSheetPlan {
  const notes: string[] = [];
  const lastDay = new Date(Date.UTC(Number(ch.month.slice(0, 4)), Number(ch.month.slice(5, 7)), 0)).getUTCDate();
  const dateOf = (day: number) => (day >= 1 && day <= lastDay ? `${ch.month}-${pad(day)}` : null);

  const clientRef = (name: string): Ref => (ch.clients[name] && ch.clients[name] !== NEW ? { id: ch.clients[name] } : { newName: name });
  const venueRef = (name: string): Ref => (ch.venues[name] && ch.venues[name] !== NEW ? { id: ch.venues[name] } : { newName: name });
  const clientName = (r: Ref) => ("id" in r ? (ctx.clients.find((c) => c.id === r.id)?.name ?? "") : r.newName);
  const venueName = (r: Ref) => ("id" in r ? (ctx.venues.find((v) => v.id === r.id)?.name ?? "") : r.newName);

  const events = new Map<string, PlanEvent>();
  function addEvent(date: string, client: Ref, venue: Ref, required: number, rate: number | null) {
    const key = `${date}|${refKey(client)}|${refKey(venue)}`;
    const cur = events.get(key);
    if (cur) {
      cur.required = Math.max(cur.required, required);
      cur.rate ??= rate;
      return cur;
    }
    const existing = "id" in client && "id" in venue ? ctx.events.find((e) => e.date === date && e.client_id === client.id && e.venue_id === venue.id) : undefined;
    const ev: PlanEvent = {
      key,
      date,
      client,
      venue,
      clientName: clientName(client),
      venueName: venueName(venue),
      required,
      rate,
      existingId: existing?.id ?? null,
      recordOnly: date < ctx.today,
    };
    events.set(key, ev);
    return ev;
  }

  // 上の段 → 現場
  const transport = new Map<string, Ref>();
  for (const c of parsed.clients) {
    const client = clientRef(c.name);
    for (const l of c.lines) {
      const date = dateOf(l.day);
      if (!date) {
        notes.push(`${c.name}「${l.venue}」${l.day}日: ${ch.month.slice(5)}月にない日付なので取り込みません`);
        continue;
      }
      addEvent(date, client, venueRef(l.venue), l.required, l.rate);
      if (l.transport) transport.set(refKey(client), client);
    }
  }

  // 下の段 → アサイン（場所と同じ日の現場に入れる）・稼働可能日
  const sameVenue = (a: string, b: string) => searchNorm(a) === searchNorm(b);
  const assignments: MonthSheetPlan["assignments"] = [];
  const availability: MonthSheetPlan["availability"] = [];
  const unknown = new Map<string, Set<number>>();
  const extraCount = new Map<string, number>();
  const pendingExtra: { place: string; date: string; staffId: string; dailyRate: number | null }[] = [];

  for (const s of parsed.staff) {
    const staffId = ch.staff[s.name];
    if (!staffId || staffId === SKIP) {
      if (s.places.length || s.shifts.length) notes.push(`${s.name}: 名簿にいない（または取り込まないにした）ので、予定と稼働可能日は取り込みません`);
      continue;
    }
    const rateOf = (day: number) => s.rates.find((r) => r.day === day);
    for (const { day, place } of s.places) {
      const date = dateOf(day);
      if (!date) continue;
      const r = rateOf(day);
      const dailyRate = r?.amount != null && r.amount > 0 ? r.amount : null;
      if (r && dailyRate == null) notes.push(`${s.name} ${day}日: 単価「${r.raw}」は取り込みません（必要なら Phase 3 で調整額として入れてください）`);

      const inSheet = [...events.values()].filter((e) => e.date === date && sameVenue(e.venueName, place));
      if (inSheet.length) {
        if (inSheet.length > 1) notes.push(`${s.name} ${day}日:「${place}」が複数の取引先にあるので、${inSheet[0].clientName} の現場に入れます`);
        assignments.push({ eventKey: inSheet[0].key, staffId, dailyRate });
        continue;
      }
      const inCrm = ctx.events.find((e) => e.date === date && sameVenue(ctx.venues.find((v) => v.id === e.venue_id)?.name ?? "", place));
      if (inCrm) {
        const ev = addEvent(date, { id: inCrm.client_id }, { id: inCrm.venue_id }, 0, null);
        assignments.push({ eventKey: ev.key, staffId, dailyRate });
        continue;
      }
      unknown.set(place, (unknown.get(place) ?? new Set()).add(day));
      pendingExtra.push({ place, date, staffId, dailyRate });
    }
    for (const { day, status } of s.shifts) {
      const date = dateOf(day);
      if (date) availability.push({ staffId, date, status });
    }
    for (const r of s.rates) if (!s.places.some((p) => p.day === r.day)) notes.push(`${s.name} ${r.day}日: 場所がない日の単価「${r.raw}」は取り込みません`);
  }

  // 上の段にない場所: 取引先を選んだものだけ現場を作る（人数はその日に入っている人数）
  for (const p of pendingExtra) {
    const client = ch.places[p.place];
    if (!client || client === SKIP) continue;
    const k = `${p.date}|${p.place}`;
    extraCount.set(k, (extraCount.get(k) ?? 0) + 1);
  }
  for (const p of pendingExtra) {
    const client = ch.places[p.place];
    if (!client || client === SKIP) continue;
    const ev = addEvent(p.date, { id: client }, venueRef(p.place), extraCount.get(`${p.date}|${p.place}`) ?? 1, null);
    assignments.push({ eventKey: ev.key, staffId: p.staffId, dailyRate: p.dailyRate });
  }
  for (const [place, days] of unknown) {
    if (!ch.places[place] || ch.places[place] === SKIP) notes.push(`「${place}」（${[...days].sort((a, b) => a - b).join("・")}日）は上の段にないので取り込みません`);
  }

  const list = [...events.values()].sort((a, b) => a.date.localeCompare(b.date) || a.venueName.localeCompare(b.venueName, "ja"));
  const newClients = [...new Set(list.flatMap((e) => ("newName" in e.client ? [e.client.newName] : [])))];
  const newVenues = [...new Set(list.flatMap((e) => ("newName" in e.venue ? [e.venue.newName] : [])))];

  return {
    newClients,
    newVenues,
    events: list,
    assignments,
    availability,
    transportClients: [...transport.values()],
    unknownPlaces: [...unknown.entries()].map(([place, days]) => ({ place, days: [...days].sort((a, b) => a - b) })),
    notes,
  };
}
