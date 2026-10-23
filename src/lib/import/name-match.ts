/**
 * シートの名前と CRM の名前の「近いもの」を探す（Phase 20）。
 *
 * 自動の読み取り（sheet-sync-plan）は、同じ名前と覚えた対応づけ（sheet_name_aliases）だけで決める。
 * ここで出す候補は、画面の「合わない名前」と月の稼働表の取り込みで**最初から選んでおく**だけ（決めるのはオーナー）。
 * 書き戻しで行を足す前の「似た名前の行がもうあるか」の確認にも同じ決め方を使う。DB を使わない。
 */
import { companyKey, searchNorm } from "@/lib/search";
import { personKey, suggestStaff, suggestVenue, venueKey } from "./line-plan";
import type { ParsedMonthSheet } from "./month-sheet";
import { buildPlan, NEW, type PlanChoices, type PlanContext, SKIP } from "./month-sheet-plan";
import type { Unmatched } from "./sheet-sync-plan";

export type Named = { id: string; name: string };
export type StaffNamed = Named & { kana?: string | null; line_name?: string | null };
export type Suggestion = { id: string; name: string; why: string };

/** 取引先: 「株式会社」「(株)」などを除いて同じ、または一方がもう一方を含む（2文字以上）ものが1件だけのとき */
export function suggestClientMatch(name: string, clients: Named[]): Suggestion | null {
  const k = companyKey(name);
  if (k.length < 2) return null;
  const exact = clients.filter((c) => companyKey(c.name) === k);
  if (exact.length === 1) return { id: exact[0].id, name: exact[0].name, why: "「株式会社」などの違いだけ" };
  if (exact.length > 1) return null;
  const part = clients.filter((c) => {
    const ck = companyKey(c.name);
    return ck.length >= 2 && (ck.includes(k) || k.includes(ck));
  });
  return part.length === 1 ? { id: part[0].id, name: part[0].name, why: "名前の一部が同じ" } : null;
}

/** 会場: 「DS」「店内」などの書き方の違いだけ、または名前の一部が同じ（いちばん近い長さのもの） */
export function suggestVenueMatch(name: string, venues: Named[]): Suggestion | null {
  const id = suggestVenue(name, venues);
  const v = id ? venues.find((x) => x.id === id) : null;
  if (!v) return null;
  const bare = (t: string) => venueKey(t).replace(/^ds/, "");
  return { id: v.id, name: v.name, why: bare(v.name) === bare(name) ? "「DS」「店内」などの違いだけ" : "名前の一部が同じ" };
}

/** スタッフ: 名前（空白・敬称の違い）・ふりがな・LINE の表示名が同じ、または名字だけ・名前だけが1人に合うとき（2人以上に合うときは出さない） */
export function suggestStaffMatch(name: string, staff: StaffNamed[]): Suggestion | null {
  const roster = staff.map((s) => ({ id: s.id, name: s.name, kana: s.kana ?? "", line_name: s.line_name ?? undefined }));
  const id = suggestStaff(name, roster);
  const s = id ? staff.find((x) => x.id === id) : null;
  if (!s) return null;
  const k = personKey(name);
  const why =
    personKey(s.name) === k ? "名前が同じ（空白や敬称の違い）" : s.kana && personKey(s.kana) === k ? "ふりがなが同じ" : s.line_name && personKey(s.line_name) === k ? "LINE の表示名が同じ" : "名字（または名前）が同じ";
  return { id: s.id, name: s.name, why };
}

export type EventRef = { client_id: string; venue_id: string };

/**
 * 下の段にだけある場所（研修など）: その場所に合う会場でいちばん多く現場をしている取引先（同じ件数で並ぶときは出さない）。
 * 合う会場がないときは、場所の名前にそのまま合う取引先（「〇〇研修」など）
 */
export function suggestPlaceMatch(place: string, ctx: { clients: Named[]; venues: Named[]; events: EventRef[] }): Suggestion | null {
  const near = suggestVenueMatch(place, ctx.venues);
  const venue = ctx.venues.find((v) => searchNorm(v.name) === searchNorm(place)) ?? (near ? ctx.venues.find((v) => v.id === near.id) : null);
  if (venue) {
    const counts = new Map<string, number>();
    for (const e of ctx.events) if (e.venue_id === venue.id) counts.set(e.client_id, (counts.get(e.client_id) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    if (top.length && (top.length === 1 || top[0][1] > top[1][1])) {
      const c = ctx.clients.find((x) => x.id === top[0][0]);
      if (c) return { id: c.id, name: c.name, why: `「${venue.name}」の現場は ${c.name} が ${top[0][1]}件` };
    }
  }
  const byName = suggestClientMatch(place, ctx.clients);
  return byName ? { ...byName, why: "場所の名前に取引先の名前が入っている" } : null;
}

export type Suggestions = { clients: Record<string, Suggestion>; venues: Record<string, Suggestion>; staff: Record<string, Suggestion>; places: Record<string, Suggestion> };

export const EMPTY_SUGGESTIONS: Suggestions = { clients: {}, venues: {}, staff: {}, places: {} };

/** 「合わない名前」のそれぞれに候補を付ける（候補がないものは入れない） */
export function suggestForUnmatched(u: Unmatched, ctx: { clients: Named[]; venues: Named[]; staff: StaffNamed[]; events: EventRef[] }): Suggestions {
  const out: Suggestions = { clients: {}, venues: {}, staff: {}, places: {} };
  for (const name of u.clients) {
    const s = suggestClientMatch(name, ctx.clients);
    if (s) out.clients[name] = s;
  }
  for (const name of u.venues) {
    const s = suggestVenueMatch(name, ctx.venues);
    if (s) out.venues[name] = s;
  }
  for (const name of u.staff) {
    const s = suggestStaffMatch(name, ctx.staff);
    if (s) out.staff[name] = s;
  }
  for (const p of u.places) {
    const s = suggestPlaceMatch(p.place, ctx);
    if (s) out.places[p.place] = s;
  }
  return out;
}

export const suggestionCount = (s: Suggestions) => Object.keys(s.clients).length + Object.keys(s.venues).length + Object.keys(s.staff).length + Object.keys(s.places).length;

/**
 * 月の稼働表の取り込み（画面）: 同じ名前で決まらなかったものに候補を入れて、最初から選んでおく。
 * 戻り値の suggested は「候補で選んだもの」（画面で「候補」と出し、確かめてもらう）。
 * 下の段にだけある場所は、スタッフの候補を当てたあとの計画で探す（人が決まらないと場所も出てこないため）
 */
export function suggestChoices(parsed: ParsedMonthSheet, ctx: PlanContext, ch: PlanChoices): { choices: PlanChoices; suggested: Suggestions } {
  const choices: PlanChoices = { ...ch, clients: { ...ch.clients }, venues: { ...ch.venues }, staff: { ...ch.staff }, places: { ...ch.places } };
  const suggested: Suggestions = { clients: {}, venues: {}, staff: {}, places: {} };
  for (const [name, v] of Object.entries(ch.clients)) {
    if (v !== NEW) continue;
    const s = suggestClientMatch(name, ctx.clients);
    if (!s) continue;
    choices.clients[name] = s.id;
    suggested.clients[name] = s;
  }
  for (const [name, v] of Object.entries(ch.venues)) {
    if (v !== NEW) continue;
    const s = suggestVenueMatch(name, ctx.venues);
    if (!s) continue;
    choices.venues[name] = s.id;
    suggested.venues[name] = s;
  }
  for (const [name, v] of Object.entries(ch.staff)) {
    if (v !== SKIP) continue;
    const s = suggestStaffMatch(name, ctx.staff);
    if (!s) continue;
    choices.staff[name] = s.id;
    suggested.staff[name] = s;
  }
  const draft = buildPlan(parsed, ctx, { ...choices, places: {} });
  for (const u of draft.unknownPlaces) {
    if ((choices.places[u.place] ?? SKIP) !== SKIP) continue;
    choices.places[u.place] ??= SKIP;
    // 場所を会場としても決めておく（同じ名前 → 近いもの → 新しく作る）
    if (!choices.venues[u.place]) {
      const exact = ctx.venues.find((x) => searchNorm(x.name) === searchNorm(u.place));
      const near = exact ? null : suggestVenueMatch(u.place, ctx.venues);
      choices.venues[u.place] = exact?.id ?? near?.id ?? NEW;
      if (near) suggested.venues[u.place] = near;
    }
    const s = suggestPlaceMatch(u.place, ctx);
    if (!s) continue;
    choices.places[u.place] = s.id;
    suggested.places[u.place] = s;
  }
  return { choices, suggested };
}

/**
 * 書き戻しで行を足す前の確認: シートの行の名前のうち、この人（取引先）のことかもしれないもの。
 * 名簿全体で候補を出したときにこの人になる名前（名字だけ・ふりがな など）。覚えた対応づけがある名前は除く
 */
export function nearStaffRows(staffId: string, rowNames: string[], roster: StaffNamed[], aliased: Set<string>): string[] {
  return [...new Set(rowNames.filter((n) => n && !aliased.has(n) && suggestStaffMatch(n, roster)?.id === staffId))];
}

export function nearClientRows(clientId: string, rowNames: string[], clients: Named[], aliased: Set<string>): string[] {
  return [...new Set(rowNames.filter((n) => n && !aliased.has(n) && suggestClientMatch(n, clients)?.id === clientId))];
}
