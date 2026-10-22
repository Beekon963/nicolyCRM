/**
 * シートの自動の読み取り（Phase 18）の、DB を使わない計算。
 *
 * - 今月・来月のタブ名（「202611」）を決める
 * - 名前が同じものを自動で選び、覚えた対応づけ（sheet_name_aliases）を当てる
 * - 合わないもの（名簿にない人・ない会場・ない取引先・上の段にない場所）は作らず・入れずに、
 *   「合わない名前」として出す（画面で対応づけると、次からは自動で入る）
 */
import { nextMonth, monthOf, type DateString } from "@/lib/date";
import type { ParsedMonthSheet } from "./month-sheet";
import { buildPlan, defaultChoices, NEW, SKIP, type PlanChoices, type PlanContext } from "./month-sheet-plan";

export type AliasKind = "client" | "venue" | "staff" | "place";
export type SheetAlias = { kind: AliasKind; sheet_name: string; target_id: string | null };

export type Unmatched = {
  clients: string[];
  venues: string[];
  staff: string[];
  /** 下の段にだけある場所（研修など）と、その日 */
  places: { place: string; days: number[] }[];
};

/** 読むタブの月（今月・来月）。YYYY-MM */
export function syncMonths(today: DateString): string[] {
  const m = monthOf(today);
  return [m, nextMonth(m)];
}

/** タブ名（「2026-11」→「202611」） */
export function tabTitle(month: string): string {
  return month.replace("-", "");
}

/** リンク共有のスプレッドシートを、ログインなしで CSV として読む URL */
export function publicCsvUrl(spreadsheetId: string, tab: string, base = "https://docs.google.com"): string {
  return `${base}/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
}

const aliasOf = (aliases: SheetAlias[], kind: AliasKind, name: string) => aliases.find((a) => a.kind === kind && a.sheet_name === name);

/**
 * 自動の突き合わせ。合わないものはシートの読み取り結果から外して（作らない）、unmatched に出す。
 * 戻り値の parsed は外したあとのもの。choices はそのまま buildPlan に渡せる。
 */
export function autoChoices(parsed: ParsedMonthSheet, ctx: PlanContext, month: string, aliases: SheetAlias[]): { choices: PlanChoices; parsed: ParsedMonthSheet; unmatched: Unmatched } {
  const ch = defaultChoices(parsed, ctx, month);
  const unmatched: Unmatched = { clients: [], venues: [], staff: [], places: [] };
  const has = (kind: "client" | "venue" | "staff", id: string) =>
    (kind === "client" ? ctx.clients : kind === "venue" ? ctx.venues : ctx.staff).some((x) => x.id === id);

  // 覚えた対応づけを当てる（対象がもうない対応づけは無視する）
  for (const name of Object.keys(ch.clients)) {
    const a = aliasOf(aliases, "client", name);
    if (a) ch.clients[name] = a.target_id && has("client", a.target_id) ? a.target_id : SKIP;
  }
  for (const name of Object.keys(ch.venues)) {
    const a = aliasOf(aliases, "venue", name);
    if (a) ch.venues[name] = a.target_id && has("venue", a.target_id) ? a.target_id : SKIP;
  }
  for (const name of Object.keys(ch.staff)) {
    const a = aliasOf(aliases, "staff", name);
    if (a) ch.staff[name] = a.target_id && has("staff", a.target_id) ? a.target_id : SKIP;
  }

  // 取引先・会場が合わないものは外す（自動では作らない）
  const skipName = (kind: AliasKind, name: string) => aliasOf(aliases, kind, name)?.target_id === null;
  const clients = parsed.clients.flatMap((c) => {
    const id = ch.clients[c.name];
    if (!id || id === NEW || id === SKIP) {
      if (!skipName("client", c.name)) unmatched.clients.push(c.name);
      return [];
    }
    const lines = c.lines.filter((l) => {
      const v = ch.venues[l.venue];
      if (v && v !== NEW && v !== SKIP) return true;
      if (!skipName("venue", l.venue)) unmatched.venues.push(l.venue);
      return false;
    });
    return [{ ...c, lines }];
  });
  const staff = parsed.staff.filter((s) => {
    const id = ch.staff[s.name];
    if (id && id !== SKIP) return true;
    if ((s.places.length || s.shifts.length) && !skipName("staff", s.name)) unmatched.staff.push(s.name);
    return false;
  });
  const filtered: ParsedMonthSheet = { ...parsed, clients, staff };

  // 下の段にだけある場所: 対応づけ（place → 取引先）があるときだけ現場を作る
  const draft = buildPlan(filtered, ctx, { ...ch, places: {} });
  for (const u of draft.unknownPlaces) {
    const a = aliasOf(aliases, "place", u.place);
    const client = a?.target_id && has("client", a.target_id) ? a.target_id : null;
    const venue = ch.venues[u.place];
    if (client && venue && venue !== NEW && venue !== SKIP) {
      ch.places[u.place] = client;
      continue;
    }
    ch.places[u.place] = SKIP;
    if (a?.target_id === null) continue;
    if (client && !skipName("venue", u.place)) unmatched.venues.push(u.place);
    else if (!client) unmatched.places.push(u);
  }
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    choices: ch,
    parsed: filtered,
    unmatched: { clients: uniq(unmatched.clients), venues: uniq(unmatched.venues), staff: uniq(unmatched.staff), places: unmatched.places },
  };
}

/** 台帳にあってシートにないもの（シートから消えたもの） */
export function vanished<T extends { key: string }>(ledger: T[], present: Iterable<string>): T[] {
  const set = new Set(present);
  return ledger.filter((r) => !set.has(r.key));
}

/** 2つの月の「合わない名前」をまとめる */
export function mergeUnmatched(a: Unmatched, b: Unmatched): Unmatched {
  const uniq = (xs: string[]) => [...new Set(xs)];
  const places = new Map<string, Set<number>>();
  for (const p of [...a.places, ...b.places]) places.set(p.place, new Set([...(places.get(p.place) ?? []), ...p.days]));
  return {
    clients: uniq([...a.clients, ...b.clients]),
    venues: uniq([...a.venues, ...b.venues]),
    staff: uniq([...a.staff, ...b.staff]),
    places: [...places.entries()].map(([place, days]) => ({ place, days: [...days].sort((x, y) => x - y) })),
  };
}
