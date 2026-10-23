import "server-only";
import type { DateString } from "@/lib/date";
import { isActive, isPassed, type Stage, turnOf } from "@/lib/jobs/stages";
import { getAppUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * 案件（Phase 21）の読み取り。案件 = event_groups（取引先からの1通の文のまとまり）。
 * 単価（event_group_private）はオーナーだけが読める（管理者には列ごと出さない）。
 */

export type JobCandidate = {
  id: string;
  staffId: string;
  staffName: string;
  stage: Stage;
  stageChangedAt: string;
  interviewSlots: string;
  interviewAt: string | null;
  interviewNote: string;
  resultNote: string;
  /** この案件の現場で、その人が入っている日（打診中・確定・補欠） */
  dates: { eventId: string; date: DateString; venue: string; status: string }[];
};

export type JobEvent = {
  id: string;
  date: DateString;
  venueId: string;
  venue: string;
  venueColor: string;
  required: number;
  confirmed: number;
  shortage: number;
  cancelled: boolean;
  people: { assignmentId: string; staffId: string; name: string; status: string }[];
};

export type Job = {
  id: string;
  name: string;
  clientId: string | null;
  clientName: string;
  receivedOn: DateString | null;
  /** エントリー期限（取引先に返事をする期限） */
  entryDeadline: DateString | null;
  closedAt: string | null;
  startTime: string | null;
  endTime: string | null;
  hoursNote: string;
  notes: string;
  contactName: string;
  /** 貼った文（単価が入っているので、オーナーだけ。管理者は空） */
  sourceText: string;
  createdAt: string;
  dateFrom: DateString | null;
  dateTo: DateString | null;
  venues: string[];
  requiredTotal: number;
  confirmedTotal: number;
  events: JobEvent[];
  candidates: JobCandidate[];
  /** オーナーだけ（管理者は undefined）。rateNote = 単価のまわりの文（「弱 30,000円 / 一律 24,000円」など） */
  rate?: { rate: number | null; transportIncluded: boolean; rateNote: string } | null;
};

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

type GroupRow = {
  id: string;
  name: string;
  client_id: string | null;
  received_on: string | null;
  entry_deadline: string | null;
  closed_at: string | null;
  start_time: string | null;
  end_time: string | null;
  hours_note: string;
  notes: string;
  contact_name: string;
  source_text: string;
  created_at: string;
  client: { name: string } | { name: string }[] | null;
};

const GROUP_SELECT = "id, name, client_id, received_on, entry_deadline, closed_at, start_time, end_time, hours_note, notes, contact_name, source_text, created_at, client:companies(name)";

async function buildJobs(rows: GroupRow[], opts: { withSource?: boolean } = {}): Promise<Job[]> {
  if (!rows.length) return [];
  const supabase = await createClient();
  const ids = rows.map((r) => r.id);
  const owner = (await getAppUser())?.role === "owner";
  const [{ data: evRows }, { data: candRows }, priv] = await Promise.all([
    supabase
      .from("event_overview")
      .select("id, date, group_id, client_id, venue_id, cancelled_at, required_total, confirmed_total, shortage_total, venue:venues(name, color), client:companies(name)")
      .in("group_id", ids)
      .order("date"),
    supabase.from("group_candidates").select("id, group_id, staff_id, stage, stage_changed_at, interview_slots, interview_at, interview_note, result_note, staff:staff(name, kana)").in("group_id", ids).order("created_at"),
    owner ? supabase.from("event_group_private").select("group_id, rate, transport_included, rate_note").in("group_id", ids) : Promise.resolve({ data: null }),
  ]);
  const events = (evRows ?? []).filter((e) => e.id && e.date);
  const eventIds = events.map((e) => e.id!);
  const { data: asgRows } = eventIds.length
    ? await supabase.from("assignments").select("id, event_id, staff_id, status, staff:staff(name)").in("event_id", eventIds).in("status", ["offered", "confirmed", "waitlisted"])
    : { data: [] as { id: string; event_id: string; staff_id: string; status: string; staff: { name: string } | { name: string }[] | null }[] };
  const asgByEvent = new Map<string, NonNullable<typeof asgRows>>();
  for (const a of asgRows ?? []) asgByEvent.set(a.event_id, [...(asgByEvent.get(a.event_id) ?? []), a]);
  const privBy = new Map((priv.data ?? []).map((p) => [p.group_id, p]));

  return rows.map((g) => {
    const evs: JobEvent[] = events
      .filter((e) => e.group_id === g.id)
      .map((e) => ({
        id: e.id!,
        date: e.date! as DateString,
        venueId: e.venue_id!,
        venue: one(e.venue)?.name ?? "",
        venueColor: one(e.venue)?.color ?? "",
        required: e.required_total ?? 0,
        confirmed: e.confirmed_total ?? 0,
        shortage: e.shortage_total ?? 0,
        cancelled: Boolean(e.cancelled_at),
        people: (asgByEvent.get(e.id!) ?? []).map((a) => ({ assignmentId: a.id, staffId: a.staff_id, name: one(a.staff)?.name ?? "", status: a.status })),
      }));
    const live = evs.filter((e) => !e.cancelled);
    const clientName = one(g.client)?.name ?? one(events.find((e) => e.group_id === g.id)?.client)?.name ?? "";
    const candidates: JobCandidate[] = (candRows ?? [])
      .filter((c) => c.group_id === g.id)
      .map((c) => ({
        id: c.id,
        staffId: c.staff_id,
        staffName: one(c.staff)?.name ?? "",
        stage: c.stage as Stage,
        stageChangedAt: c.stage_changed_at,
        interviewSlots: c.interview_slots,
        interviewAt: c.interview_at,
        interviewNote: c.interview_note,
        resultNote: c.result_note,
        dates: live.flatMap((e) => e.people.filter((p) => p.staffId === c.staff_id).map((p) => ({ eventId: e.id, date: e.date, venue: e.venue, status: p.status }))),
      }));
    const p = privBy.get(g.id);
    return {
      id: g.id,
      name: g.name,
      clientId: g.client_id ?? events.find((e) => e.group_id === g.id)?.client_id ?? null,
      clientName,
      receivedOn: (g.received_on as DateString | null) ?? null,
      entryDeadline: (g.entry_deadline as DateString | null) ?? null,
      closedAt: g.closed_at,
      startTime: g.start_time?.slice(0, 5) ?? null,
      endTime: g.end_time?.slice(0, 5) ?? null,
      hoursNote: g.hours_note,
      notes: g.notes,
      contactName: g.contact_name,
      // 貼った文には単価が入っているので、オーナーだけに出す
      sourceText: opts.withSource && owner ? g.source_text : "",
      createdAt: g.created_at,
      dateFrom: live[0]?.date ?? null,
      dateTo: live.at(-1)?.date ?? null,
      venues: [...new Set(live.map((e) => e.venue))],
      requiredTotal: live.reduce((s, e) => s + e.required, 0),
      confirmedTotal: live.reduce((s, e) => s + e.confirmed, 0),
      events: evs,
      candidates,
      ...(owner ? { rate: p ? { rate: p.rate, transportIncluded: p.transport_included, rateNote: p.rate_note } : null } : {}),
    };
  });
}

/** 案件の一覧（進行中が上。終わった案件は includeClosed のときだけ）。現場も取引先もないまとまりは出さない */
export async function listJobs(opts: { includeClosed?: boolean } = {}): Promise<Job[]> {
  const supabase = await createClient();
  let q = supabase.from("event_groups").select(GROUP_SELECT).order("received_on", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(200);
  if (!opts.includeClosed) q = q.is("closed_at", null);
  const { data } = await q;
  const jobs = await buildJobs((data ?? []) as GroupRow[]);
  return jobs.filter((j) => j.clientId || j.events.length);
}

export async function getJob(id: string): Promise<Job | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("event_groups").select(GROUP_SELECT).eq("id", id).maybeSingle();
  if (!data) return null;
  const [job] = await buildJobs([data as GroupRow], { withSource: true });
  return job ?? null;
}

export type JobCounts = { ourTurn: number; overdue: number; waitingResult: number; jobs: number };

/** ホームの要対応・メニューの件数: 進行中の案件で自分の番の人（24時間以上は overdue） */
export async function getJobCounts(now = new Date()): Promise<JobCounts> {
  const supabase = await createClient();
  const { data } = await supabase.from("group_candidates").select("stage, stage_changed_at, interview_at, group:event_groups!inner(closed_at)").is("group.closed_at", null);
  let ourTurn = 0;
  let overdue = 0;
  let waitingResult = 0;
  for (const c of data ?? []) {
    const stage = c.stage as Stage;
    if (!isActive(stage) && !isPassed(stage)) continue;
    const turn = turnOf(stage, c.interview_at, now);
    if (turn === "us") {
      ourTurn++;
      if (now.getTime() - new Date(c.stage_changed_at).getTime() > 24 * 3600_000) overdue++;
    }
    if (stage === "interviewed") waitingResult++;
  }
  const { count } = await supabase.from("event_groups").select("id", { count: "exact", head: true }).is("closed_at", null).not("client_id", "is", null);
  return { ourTurn, overdue, waitingResult, jobs: count ?? 0 };
}
