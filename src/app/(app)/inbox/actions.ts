"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { type Proposal, PROPOSAL_TOOLS } from "@/lib/ai/proposals";
import { ToolInputError } from "@/lib/ai/common";
import { assertMember } from "@/lib/auth";
import { getMasters } from "@/lib/data/masters";
import { dictFor, loadAliases, loadClientItemNames } from "@/lib/data/report-dict";
import { addDays, monthOf, nextMonth, resolveMonthDay, todayJst } from "@/lib/date";
import { suggestStaff, suggestVenue } from "@/lib/import/line-plan";
import { isActive, type Stage, STAGE_INFO } from "@/lib/jobs/stages";
import { type AvailabilityStatus, classifyPaste, extractComment } from "@/lib/inbox/classify";
import { normalizeDateLabel, resolveItemName } from "@/lib/report-convert";
import { createClient } from "@/lib/supabase/server";

/**
 * 「LINE の文を貼るだけ」（Phase 18）。貼った文を見分けて、登録の確認カード（AI と同じ形）を出す。
 * 読み取りはログイン中の人の権限で行い、登録は確認カードの「登録する」（runAiProposal → executeProposal）だけ。
 * 金額は扱わない。
 */

export type PendingOffer = { id: string; staffId: string; staffName: string; date: string; venue: string; role: string };
export type AvailabilityDay = { date: string; status: AvailabilityStatus };
export type EventOption = { id: string; label: string; clientId: string };
export type StaffOption = { id: string; name: string };

export type CandidateOption = { id: string; label: string; stage: Stage };
export type JobOption = { id: string; label: string; candidates: { id: string; staffId: string }[] };
export type ReassignLine = { venue: string; eventId: string | null; names: { name: string; staffId: string | null }[] };

export type ReadResult =
  | { kind: "details"; venueName: string; venueId: string | null; body: string }
  | { kind: "job"; lines: number; month: string | null; venues: string[] }
  | { kind: "slots"; slots: string[]; candidates: CandidateOption[]; matchedId: string | null }
  | { kind: "result"; results: { name: string; passed: boolean; staffId: string | null; staffName: string | null }[]; jobs: JobOption[]; jobId: string | null }
  | { kind: "reassign"; date: string | null; out: ReassignLine | null; lines: ReassignLine[]; eventsOnDate: EventOption[]; roleId: string | null }
  | { kind: "recruit"; dates: number; venue: string }
  | { kind: "report"; proposal: Proposal; notes: string[] }
  | { kind: "report_unmatched"; read: { date: string; venue: string; people: string[]; items: string[] }; reason: string; events: EventOption[]; staff: StaffOption[]; needStaff: boolean }
  | { kind: "availability"; month: string; days: AvailabilityDay[]; unread: string[] }
  | { kind: "reply"; positive: boolean; offers: PendingOffer[]; matchedStaffId: string | null }
  | { kind: "unknown" };

const textSchema = z.string().trim().min(1).max(20_000);
const dayList = z.array(z.object({ date: z.iso.date(), status: z.enum(["ok", "maybe", "ng"]) })).min(1).max(62);

type Tool = (typeof PROPOSAL_TOOLS)[number];
const tool = (name: string): Tool => PROPOSAL_TOOLS.find((t) => t.name === name)!;

async function runTool<T>(name: string, ctx: Parameters<Tool["run"]>[0], input: T): Promise<ActionResult<Proposal>> {
  try {
    const r = (await tool(name).run(ctx, input as never)) as { proposal?: Proposal };
    if (!r.proposal) return fail("確認カードを作れませんでした");
    return ok(undefined, r.proposal);
  } catch (e) {
    return fail(e instanceof ToolInputError ? e.message : "確認カードを作れませんでした。内容を確かめてください");
  }
}

/** 貼った文を読み取る。eventId / staffId は、読み直すときに画面で選んだもの */
export async function readPaste(input: string, pick: { eventId?: string; staffId?: string } = {}): Promise<ActionResult<ReadResult>> {
  const user = await assertMember();
  const p = textSchema.safeParse(input);
  if (!p.success) return fail("LINE の文を貼ってください");
  const text = p.data;
  const supabase = await createClient();
  const today = todayJst();
  const [masters, { data: staffRows }, { data: venueRows }] = await Promise.all([
    getMasters(),
    supabase.from("staff").select("id, name, kana, line_name").eq("status", "active").order("kana"),
    supabase.from("venues").select("id, name").eq("is_active", true),
  ]);
  const staff = (staffRows ?? []).map((s) => ({ id: s.id, name: s.name, kana: s.kana ?? "", line_name: s.line_name ?? undefined }));
  const venues = venueRows ?? [];
  const person = (name: string) => suggestStaff(name, staff);
  const roleNames = masters.roles.filter((r) => r.is_active).map((r) => r.name);
  const c = classifyPaste(text, { today, roleNames, person, defaultMonth: nextMonth(monthOf(today)) });

  if (c.kind === "details") {
    return ok(undefined, { kind: "details", venueName: c.detail.venue, venueId: c.detail.venue ? suggestVenue(c.detail.venue, venues) : null, body: c.detail.body });
  }
  if (c.kind === "recruit") return ok(undefined, { kind: "recruit", dates: c.recruit.dates.length, venue: c.recruit.venue });
  if (c.kind === "job") return ok(undefined, { kind: "job", lines: c.job.lines.length, month: c.job.month, venues: [...new Set(c.job.lines.map((l) => l.venue))] });
  if (c.kind === "slots") {
    // 進行中の案件の候補（終わっていない人）。だれの分かは画面で選ぶ
    const { data } = await supabase.from("group_candidates").select("id, stage, staff_id, staff:staff(name), group:event_groups!inner(name, closed_at)").is("group.closed_at", null).order("created_at");
    const candidates: CandidateOption[] = (data ?? [])
      .filter((x) => isActive(x.stage as Stage))
      .map((x) => ({ id: x.id, stage: x.stage as Stage, label: `${one(x.staff)?.name ?? ""}（${one(x.group)?.name ?? ""}・${STAGE_INFO[x.stage as Stage].label}）` }));
    // 文の中に名字があれば、その人を先に選ぶ
    const norm = text.normalize("NFKC").replace(/[\s　]/g, "");
    const hit = (data ?? []).filter((x) => {
      const sei = (one(x.staff)?.name ?? "").normalize("NFKC").split(/[\s　]+/)[0];
      return sei.length >= 2 && norm.includes(sei);
    });
    const waiting = candidates.filter((x) => x.stage === "sheet_sent");
    const matchedId = hit.length === 1 ? hit[0].id : waiting.length === 1 ? waiting[0].id : null;
    return ok(undefined, { kind: "slots", slots: c.slots.map((s) => s.text), candidates, matchedId });
  }
  if (c.kind === "result") {
    const { data: groups } = await supabase.from("event_groups").select("id, name, client:companies(name), candidates:group_candidates(id, staff_id)").is("closed_at", null).not("client_id", "is", null).order("received_on", { ascending: false, nullsFirst: false });
    const results = c.results.map((r) => {
      const id = person(r.name);
      return { name: r.name, passed: r.passed, staffId: id, staffName: id ? (staff.find((s) => s.id === id)?.name ?? null) : null };
    });
    const jobs: JobOption[] = (groups ?? []).map((g) => ({ id: g.id, label: `${g.name}（${one(g.client)?.name ?? ""}）`, candidates: (g.candidates ?? []).map((x) => ({ id: x.id, staffId: x.staff_id })) }));
    const ids = results.flatMap((r) => (r.staffId ? [r.staffId] : []));
    const fit = jobs.filter((j) => ids.length && ids.every((id) => j.candidates.some((x) => x.staffId === id)));
    return ok(undefined, { kind: "result", results, jobs, jobId: fit.length === 1 ? fit[0].id : null });
  }
  if (c.kind === "reassign") {
    const r = c.reassign;
    const date = r.date;
    const { data: evs } = date ? await supabase.from("events").select("id, venue_id, venue:venues(name), client:companies(name)").eq("date", date).is("cancelled_at", null).order("created_at") : { data: [] };
    const eventsOnDate: EventOption[] = (evs ?? []).map((e) => ({ id: e.id, label: `${one(e.venue)?.name ?? ""}（${one(e.client)?.name ?? ""}）`, clientId: "" }));
    const eventOf = (venueText: string) => {
      const vid = venueText ? suggestVenue(venueText, venues) : null;
      return vid ? ((evs ?? []).find((e) => e.venue_id === vid)?.id ?? null) : null;
    };
    const names = (xs: string[]) => xs.map((n) => ({ name: n, staffId: person(n) }));
    const roleId = masters.roles.find((x) => x.is_active)?.id ?? null;
    return ok(undefined, {
      kind: "reassign",
      date,
      out: r.outNames.length ? { venue: r.outVenue, eventId: eventOf(r.outVenue), names: names(r.outNames) } : null,
      lines: r.lines.map((l) => ({ venue: l.venue, eventId: eventOf(l.venue), names: names(l.names) })),
      eventsOnDate,
      roleId,
    });
  }
  if (c.kind === "availability") return ok(undefined, { kind: "availability", month: c.availability.month, days: c.availability.days, unread: c.availability.unread });
  if (c.kind === "reply") {
    const { data } = await supabase
      .from("assignments")
      .select("id, staff_id, role_id, staff:staff(name), event:events!inner(id, date, cancelled_at, venue:venues(name))")
      .eq("status", "offered")
      .gte("event.date", today)
      .is("event.cancelled_at", null)
      .order("offered_at");
    const offers: PendingOffer[] = (data ?? []).map((a) => {
      const ev = one(a.event);
      return { id: a.id, staffId: a.staff_id, staffName: one(a.staff)?.name ?? "", date: ev?.date ?? "", venue: one(ev?.venue)?.name ?? "", role: masters.roleById.get(a.role_id)?.name ?? "" };
    });
    const norm = text.normalize("NFKC").replace(/[\s　]/g, "");
    const matched = offers.find((o) => {
      const sei = o.staffName.normalize("NFKC").split(/[\s　]+/)[0];
      return sei.length >= 2 && norm.includes(sei);
    });
    return ok(undefined, { kind: "reply", positive: c.positive, offers, matchedStaffId: matched?.staffId ?? null });
  }
  if (c.kind === "report") {
    // 日付・会場・人・項目を CRM に当てて、速報の確認カードを出す
    const nicoly = c.nicoly;
    const line = c.line;
    const label = nicoly?.date ? normalizeDateLabel(nicoly.date) : "";
    const md = label.match(/^(\d{1,2})\/(\d{1,2})$/);
    let date = md ? (resolveMonthDay(Number(md[1]), Number(md[2]), today) ?? today) : (line?.date ?? today);
    if (date > today) date = today;
    const venueName = nicoly?.venue || line?.venue || "";
    const venueId = venueName ? suggestVenue(venueName, venues) : null;
    const people = [...new Set([...(nicoly?.workers ?? []), ...(nicoly?.lines ?? []).flatMap((l) => (l.person ? [l.person] : [])), ...(line?.people ?? [])])];
    const items = [...new Set([...(nicoly?.lines ?? []).map((l) => l.raw), ...(line?.lines ?? []).map((l) => l.raw)])];
    const read = { date, venue: venueName, people, items };

    // 候補の現場（直近2週間）。会場が分かればその会場、分からなければ全部
    const { data: recent } = await supabase
      .from("events")
      .select("id, date, client_id, venue:venues(name), assignments(id, status)")
      .gte("date", addDays(today, -14))
      .lte("date", today)
      .is("cancelled_at", null)
      .order("date", { ascending: false })
      .limit(60);
    const withPeople = (recent ?? []).filter((e) => (e.assignments ?? []).some((a) => a.status === "confirmed"));
    const events: EventOption[] = withPeople.map((e) => ({ id: e.id, label: `${e.date.slice(5).replace("-", "/")} ${one(e.venue)?.name ?? ""}`, clientId: e.client_id }));
    const unmatched = (reason: string, needStaff = false): ActionResult<ReadResult> => ok(undefined, { kind: "report_unmatched", read, reason, events, staff: staff.map((s) => ({ id: s.id, name: s.name })), needStaff });

    let eventId = pick.eventId && z.uuid().safeParse(pick.eventId).success ? pick.eventId : null;
    if (!eventId) {
      if (!venueId) return unmatched(venueName ? `会場「${venueName}」が CRM の会場に見つかりません。どの現場の報告か選んでください` : "会場が書いてありません。どの現場の報告か選んでください");
      const hit = (recent ?? []).filter((e) => e.date === date && one(e.venue) && venues.find((v) => v.id === venueId)?.name === one(e.venue)?.name);
      if (!hit.length) return unmatched(`${date.slice(5).replace("-", "/")} に「${venues.find((v) => v.id === venueId)?.name}」の現場がありません。どの現場の報告か選んでください`);
      eventId = hit[0].id;
    }
    const { data: ev } = await supabase.from("events").select("id, date, client_id, venue:venues(name)").eq("id", eventId).maybeSingle();
    if (!ev) return unmatched("現場が見つかりません");
    const { data: asgRows } = await supabase.from("assignments").select("id, staff_id, staff:staff(name)").eq("event_id", ev.id).eq("status", "confirmed");
    const asgs = (asgRows ?? []).map((a) => ({ id: a.id, staffId: a.staff_id, name: one(a.staff)?.name ?? "" }));
    if (!asgs.length) return unmatched("この現場には確定した人がいません。現場の画面で確定してから入れてください");

    // 項目の辞書（取引先の項目・言いかえ表）
    const [aliases, itemNames] = await Promise.all([loadAliases(), loadClientItemNames(ev.client_id)]);
    const dict = dictFor(ev.client_id, itemNames, aliases);
    const itemIdByName = new Map(masters.items.map((i) => [i.name, i.id]));
    const notes: string[] = [];
    const itemId = (raw: string): string | null => {
      const r = resolveItemName(raw, dict);
      const id = r.name ? itemIdByName.get(r.name) : null;
      if (!id) notes.push(`「${raw}」はどの獲得項目か分からないので入れません（言いかえ表に足すと次から入ります）`);
      return id ?? null;
    };
    const asgOf = (name: string | undefined): (typeof asgs)[number] | null => {
      if (name) {
        const id = person(name);
        const hit = asgs.find((a) => a.staffId === id);
        if (hit) return hit;
        if (id) notes.push(`${name} さんはこの現場に確定していないので、その分は入れません`);
        else notes.push(`「${name}」がだれか分かりません`);
        return null;
      }
      return null;
    };
    const picked = pick.staffId ? asgs.find((a) => a.staffId === pick.staffId) : null;
    const counts = new Map<string, Map<string, number>>();
    const add = (asgId: string, item: string, count: number) => {
      const m = counts.get(asgId) ?? new Map<string, number>();
      m.set(item, (m.get(item) ?? 0) + count);
      counts.set(asgId, m);
    };
    const fallback = (): (typeof asgs)[number] | null => picked ?? (asgs.length === 1 ? asgs[0] : nicoly?.workers.length === 1 ? asgOf(nicoly.workers[0]) : null);
    let ambiguous = false;
    if (nicoly) {
      for (const l of nicoly.lines) {
        if (!(l.count > 0)) continue;
        const target = l.person ? asgOf(l.person) : fallback();
        if (!target) {
          if (!l.person) ambiguous = true;
          continue;
        }
        const id = itemId(l.raw);
        if (id) add(target.id, id, Math.round(l.count));
      }
    } else if (line) {
      for (const l of line.lines) {
        const id = itemId(l.raw);
        if (!id) continue;
        for (const s of l.shares) {
          const target = asgOf(s.person) ?? fallback();
          if (!target) {
            ambiguous = true;
            continue;
          }
          if (!Number.isInteger(s.count)) notes.push(`${s.person} の「${l.raw}」${s.count}件は ${Math.round(s.count)} 件として入れます（実績確認で直せます）`);
          add(target.id, id, Math.round(s.count));
        }
      }
      if (line.zero && !counts.size) {
        const target = fallback();
        if (target) counts.set(target.id, new Map());
        else ambiguous = true;
      }
    }
    if (ambiguous && !counts.size) {
      return ok(undefined, {
        kind: "report_unmatched",
        read,
        reason: "だれの分か分かりません。だれの報告か選んでください",
        events: [{ id: ev.id, label: `${ev.date.slice(5).replace("-", "/")} ${one(ev.venue)?.name ?? ""}`, clientId: ev.client_id }],
        staff: asgs.map((a) => ({ id: a.staffId, name: a.name })),
        needStaff: true,
      });
    }
    if (!counts.size) return fail(notes[0] ?? "件数が読み取れませんでした");
    const comment = [nicoly?.comment || extractComment(text), ...(nicoly?.lines ?? []).flatMap((l) => l.notes ?? [])].filter(Boolean).join("\n").slice(0, 1000);
    const entries = [...counts.entries()].map(([assignment_id, m]) => ({ assignment_id, counts: [...m.entries()].map(([item_id, count]) => ({ item_id, count })), comment }));
    const r = await runTool("propose_reports", { supabase, user, today }, { entries });
    if (!r.ok) return r as ActionResult<ReadResult>;
    return ok(undefined, { kind: "report", proposal: r.data!, notes: [...new Set(notes)] });
  }
  return ok(undefined, { kind: "unknown" });
}

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** 稼働可能日: だれの分か選んだら、確認カードを出す */
export async function proposeAvailabilityFor(input: { staffId: string; days: AvailabilityDay[] }): Promise<ActionResult<Proposal>> {
  const user = await assertMember();
  const p = z.object({ staffId: z.uuid(), days: dayList }).safeParse(input);
  if (!p.success) return fail("だれの分か選んでください");
  const supabase = await createClient();
  return runTool("propose_availability", { supabase, user, today: todayJst() }, { entries: [{ staff_id: p.data.staffId, days: p.data.days }] });
}

/** 面談の候補日時: だれの分か選んだら、確認カードを出す（Phase 21） */
export async function proposeSlotsFor(input: { candidateId: string; slots: string[] }): Promise<ActionResult<Proposal>> {
  const user = await assertMember();
  const p = z.object({ candidateId: z.uuid(), slots: z.array(z.string().trim().min(1).max(100)).min(1).max(20) }).safeParse(input);
  if (!p.success) return fail("だれの分か選んでください");
  const supabase = await createClient();
  return runTool("propose_interview_slots", { supabase, user, today: todayJst() }, { candidate_id: p.data.candidateId, slots: p.data.slots.join("\n") });
}

/** 合否: 案件を選んだら、確認カードを出す（候補にいない人は入れない。案件の画面で候補に足してから） */
export async function proposeScreeningFor(input: { groupId: string; results: { staffId: string; passed: boolean }[] }): Promise<ActionResult<Proposal>> {
  const user = await assertMember();
  const p = z.object({ groupId: z.uuid(), results: z.array(z.object({ staffId: z.uuid(), passed: z.boolean() })).min(1).max(40) }).safeParse(input);
  if (!p.success) return fail("案件を選んでください");
  const supabase = await createClient();
  const { data: cands } = await supabase.from("group_candidates").select("id, staff_id, staff:staff(name)").eq("group_id", p.data.groupId).in("staff_id", p.data.results.map((r) => r.staffId));
  const byStaff = new Map((cands ?? []).map((c) => [c.staff_id, c]));
  const missing = p.data.results.filter((r) => !byStaff.has(r.staffId));
  if (missing.length) {
    const { data: names } = await supabase.from("staff").select("name").in("id", missing.map((m) => m.staffId));
    return fail(`${(names ?? []).map((n) => n.name).join("・")} はこの案件の候補にいません。案件の画面で「候補を足す」をしてから、もう一度読み取ってください`);
  }
  const results = p.data.results.map((r) => ({ candidate_id: byStaff.get(r.staffId)!.id, passed: r.passed, note: "" }));
  return runTool("propose_screening", { supabase, user, today: todayJst() }, { group_id: p.data.groupId, results });
}

/** 人員変更: 現場と人が決まったら、確認カードを出す */
export async function proposeReassignFor(input: { date: string; roleId: string; lines: { eventId: string; staffIds: string[] }[]; out: { eventId: string; staffIds: string[] }[] }): Promise<ActionResult<Proposal>> {
  const user = await assertMember();
  const side = z.array(z.object({ eventId: z.uuid(), staffIds: z.array(z.uuid()).min(1).max(20) })).max(20);
  const p = z.object({ date: z.iso.date(), roleId: z.uuid(), lines: side, out: side }).safeParse(input);
  if (!p.success) return fail("現場と人を選んでください");
  if (!p.data.lines.length && !p.data.out.length) return fail("変えるものがありません");
  const supabase = await createClient();
  return runTool(
    "propose_reassign",
    { supabase, user, today: todayJst() },
    { date: p.data.date, role_id: p.data.roleId, lines: p.data.lines.map((l) => ({ event_id: l.eventId, staff_ids: l.staffIds })), out: p.data.out.map((l) => ({ event_id: l.eventId, staff_ids: l.staffIds })) },
  );
}

/** 案件詳細を会場のメモに足す（オーナー・管理者） */
export async function saveVenueDetails(input: { venueId: string; body: string }): Promise<ActionResult> {
  await assertMember();
  const p = z.object({ venueId: z.uuid(), body: z.string().trim().min(1).max(5000) }).safeParse(input);
  if (!p.success) return fail("会場を選んでください");
  const supabase = await createClient();
  const { data: v } = await supabase.from("venues").select("name, memo").eq("id", p.data.venueId).maybeSingle();
  if (!v) return fail("会場が見つかりません");
  if (v.memo.includes(p.data.body)) return ok(`${v.name} のメモにもう入っています`);
  const head = `【LINE の現場詳細（${todayJst().replaceAll("-", "/")}）】`;
  const { error } = await supabase
    .from("venues")
    .update({ memo: [v.memo.trim(), `${head}\n${p.data.body}`].filter(Boolean).join("\n\n") })
    .eq("id", p.data.venueId);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/venues", "layout");
  return ok(`${v.name} のメモに入れました`);
}

/** LINE から転送された文を「済み」にする */
export async function markInboxDone(id: string): Promise<ActionResult> {
  await assertMember();
  if (!z.uuid().safeParse(id).success) return fail("選び直してください");
  const supabase = await createClient();
  const { error } = await supabase.from("line_inbox").update({ done_at: new Date().toISOString() }).eq("id", id);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/inbox");
  revalidatePath("/");
  return ok("済みにしました");
}
