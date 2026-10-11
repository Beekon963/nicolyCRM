import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createEvent, createEventsBulk, offerStaff } from "@/app/(app)/events/actions";
import { recordActivity } from "@/app/(app)/sales/activity-actions";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { addDays, formatShortJa } from "@/lib/date";
import { getMasters } from "@/lib/data/masters";
import { ACTIVITY_KIND, ACTIVITY_RESULT, ASSIGNMENT_STATUS, AVAILABILITY, COMPANY_STATUS } from "@/lib/labels";
import { type AiContext, type AiTool, dateArg, one, t5, ToolInputError } from "./common";

/**
 * AI アシスタントの「登録・変更」（Phase 4-4）。
 * AI は propose_* で確認カードを出すだけ。利用者が画面で「登録する」を押したら executeProposal で登録する。
 * - 登録はログイン中の人の権限（RLS）で行い、変更履歴（監査ログ）も今までの画面と同じに残る
 * - 登録の前に、ID と状態をもう一度確かめる（AI や画面から来た値をそのまま信じない）
 * - 金額は扱わない
 */

export type ProposalKind = "reports" | "availability" | "activity" | "offers" | "events";
export type ProposalRow = { label: string; detail: string; skip?: string };
export type Proposal = { id: string; kind: ProposalKind; title: string; rows: ProposalRow[]; warnings: string[]; payload: unknown };
export type ProposalUndo = { kind: "activity"; id: string; before: { status: string; next_action_date: string | null; next_action: string } } | { kind: "offers"; ids: string[] };

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "時刻は HH:MM の形で入れてください");

export const PAYLOAD = {
  reports: z.object({
    entries: z
      .array(
        z.object({
          assignment_id: z.uuid(),
          counts: z.array(z.object({ item_id: z.uuid(), count: z.number().int().min(0).max(999) })).max(30),
          comment: z.string().trim().max(1000).default(""),
        }),
      )
      .min(1)
      .max(60),
  }),
  availability: z.object({
    entries: z
      .array(z.object({ staff_id: z.uuid(), days: z.array(z.object({ date: dateArg, status: z.enum(["ok", "maybe", "ng"]) })).min(1).max(62) }))
      .min(1)
      .max(40),
  }),
  activity: z.object({
    company_id: z.uuid(),
    kind: z.enum(["call", "line", "email", "visit", "meeting", "other"]),
    result: z.enum(["reached", "absent", "callback", "sent_material", "appointment", "declined"]).nullable().default(null),
    memo: z.string().trim().max(2000).default(""),
    next_action_date: dateArg.nullable().default(null),
    next_action: z.string().trim().max(200).default(""),
    status: z.enum(["not_contacted", "contacted", "meeting_set", "met", "active", "dormant"]).nullable().default(null),
  }),
  offers: z.object({ event_id: z.uuid(), role_id: z.uuid(), staff_ids: z.array(z.uuid()).min(1).max(30) }),
  events: z.object({
    client_id: z.uuid(),
    venue_id: z.uuid(),
    dates: z.array(dateArg).min(1).max(31),
    start_time: time.nullable().default(null),
    end_time: time.nullable().default(null),
    meeting_time: time.nullable().default(null),
    meeting_place: z.string().trim().max(200).default(""),
    belongings: z.string().trim().max(500).default(""),
    notes: z.string().trim().max(1000).default(""),
    requirements: z.array(z.object({ role_id: z.uuid(), count: z.number().int().min(1).max(50) })).min(1).max(10),
  }),
} satisfies Record<ProposalKind, z.ZodType>;

const proposal = (kind: ProposalKind, title: string, rows: ProposalRow[], warnings: string[], payload: unknown) => ({
  proposal: { id: randomUUID(), kind, title, rows, warnings, payload } satisfies Proposal,
});

// ---------------------------------------------------------------------------
// 確認カードを作る（読むだけ。まだ登録しない）
// ---------------------------------------------------------------------------

type ReportAsg = {
  id: string;
  status: keyof typeof ASSIGNMENT_STATUS;
  role_id: string;
  staff: { name: string } | null;
  event: { date: string; cancelled_at: string | null; venue: { name: string } | null; client: { name: string } | null } | null;
  report: { submitted_at: string | null; confirmed_at: string | null } | null;
};

async function loadReportTargets(ctx: AiContext, ids: string[]) {
  const { data } = await ctx.supabase
    .from("assignments")
    .select("id, status, role_id, staff:staff(name), event:events(date, cancelled_at, venue:venues(name), client:companies(name)), report:reports(submitted_at, confirmed_at)")
    .in("id", ids);
  return new Map(
    (data ?? []).map((a) => {
      const ev = one(a.event);
      const row: ReportAsg = { ...a, staff: one(a.staff), event: ev ? { ...ev, venue: one(ev.venue), client: one(ev.client) } : null, report: one(a.report) };
      return [a.id, row];
    }),
  );
}

/** 報告を入れられない理由（入れられるなら null） */
function reportSkip(a: ReportAsg | undefined, today: string): string | null {
  if (!a || !a.event) return "見つかりません";
  if (a.status !== "confirmed") return `状態が「${ASSIGNMENT_STATUS[a.status].label}」です`;
  if (a.event.cancelled_at) return "中止の現場です";
  if (a.event.date > today) return "まだ先の現場です";
  if (a.report?.confirmed_at) return "実績はもう確定しています（実績確認の画面で直せます）";
  if (a.report?.submitted_at) return "本人がもう報告しています（実績確認の画面で確定してください）";
  return null;
}

const proposeReports: AiTool = {
  name: "propose_reports",
  label: "報告の確認カードを作っています",
  description:
    "実績の報告（獲得件数・コメント）を、スタッフの代わりに入れる確認カードを出す（例: LINE のスクショに書かれた件数）。assignment_id は list_events / get_event で確かめた「確定」のアサイン。item_id は獲得項目の ID。入るのは速報で、確定は実績確認の画面で行う。本人がもう報告している人・まだ先の現場は入れない。",
  schema: PAYLOAD.reports,
  run: async (ctx, input: z.infer<typeof PAYLOAD.reports>) => {
    const masters = await getMasters();
    const targets = await loadReportTargets(ctx, input.entries.map((e) => e.assignment_id));
    for (const e of input.entries) for (const c of e.counts) if (!masters.itemById.has(c.item_id)) throw new ToolInputError(`獲得項目の ID（${c.item_id}）が違います`);
    const rows = input.entries.map((e) => {
      const a = targets.get(e.assignment_id);
      const counts = e.counts.map((c) => `${masters.itemById.get(c.item_id)?.name} ${c.count}`).join("・");
      return {
        label: a?.event ? `${formatShortJa(a.event.date)} ${a.event.venue?.name ?? ""} / ${a.staff?.name ?? ""}（${masters.roleById.get(a.role_id)?.name ?? ""}）` : "（見つからないアサイン）",
        detail: [counts || "件数なし", e.comment && `コメント: ${e.comment}`].filter(Boolean).join(" / "),
        skip: reportSkip(a, ctx.today) ?? undefined,
      };
    });
    if (rows.every((r) => r.skip)) throw new ToolInputError(`入れられる報告がありません: ${rows.map((r) => `${r.label} → ${r.skip}`).join(" / ")}`);
    return proposal("reports", `実績の報告を入れる（${rows.filter((r) => !r.skip).length}人分）`, rows, ["入るのは速報です。確定は「実績確認」の画面で行ってください。"], input);
  },
};

const proposeAvailability: AiTool = {
  name: "propose_availability",
  label: "稼働可能日の確認カードを作っています",
  description:
    "スタッフの稼働可能日（ok=○ 稼働できる / maybe=△ 調整すれば可 / ng=× 稼働できない）を、代わりに入れる確認カードを出す（例: LINE で届いた「5日と6日いけます」）。入力元は「管理者」で残る。今入っている印は上書きする。",
  schema: PAYLOAD.availability,
  run: async (ctx, input: z.infer<typeof PAYLOAD.availability>) => {
    const ids = input.entries.map((e) => e.staff_id);
    const dates = input.entries.flatMap((e) => e.days.map((d) => d.date));
    const min = dates.reduce((a, b) => (a < b ? a : b));
    const max = dates.reduce((a, b) => (a > b ? a : b));
    if (min < addDays(ctx.today, -31) || max > addDays(ctx.today, 180)) throw new ToolInputError("入れられるのは、1か月前から半年先までの日付です");
    const [{ data: staff }, { data: current }] = await Promise.all([
      ctx.supabase.from("staff").select("id, name").in("id", ids),
      ctx.supabase.from("availability").select("staff_id, date, status").in("staff_id", ids).gte("date", min).lte("date", max),
    ]);
    const name = new Map((staff ?? []).map((s) => [s.id, s.name]));
    const missing = ids.filter((id) => !name.has(id));
    if (missing.length) throw new ToolInputError(`スタッフの ID が違います: ${missing.join(", ")}`);
    const cur = new Map((current ?? []).map((c) => [`${c.staff_id}:${c.date}`, c.status]));
    const rows = input.entries.map((e) => ({
      label: name.get(e.staff_id)!,
      detail: [...e.days]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((d) => {
          const was = cur.get(`${e.staff_id}:${d.date}`);
          return `${formatShortJa(d.date)} ${AVAILABILITY[d.status].mark}${was && was !== d.status ? `（今は${AVAILABILITY[was].mark}）` : ""}`;
        })
        .join("、"),
    }));
    return proposal("availability", `稼働可能日を入れる（${rows.length}人）`, rows, [], input);
  },
};

const proposeActivity: AiTool = {
  name: "propose_activity",
  label: "営業の記録の確認カードを作っています",
  description:
    "営業の活動（電話・LINE・メール・訪問・商談など）と次回アクションを記録する確認カードを出す。kind: call=架電 line=LINE email=メール visit=訪問 meeting=商談 other=その他。result: reached=話せた absent=不在 callback=折り返し待ち sent_material=資料送付 appointment=アポ獲得 declined=断られた。status は変えるときだけ（not_contacted=未接触 contacted=接触済み meeting_set=商談設定 met=商談済み active=取引中 dormant=休眠）。",
  schema: PAYLOAD.activity,
  run: async (ctx, input: z.infer<typeof PAYLOAD.activity>) => {
    const { data: c } = await ctx.supabase.from("companies").select("name, status").eq("id", input.company_id).maybeSingle();
    if (!c) throw new ToolInputError("その会社は見つかりません");
    if (input.next_action_date && input.next_action_date < ctx.today) throw new ToolInputError("次回アクション日は今日以降にしてください");
    const rows = [
      { label: "会社", detail: c.name },
      { label: "記録", detail: `${ACTIVITY_KIND[input.kind]}${input.result ? `（${ACTIVITY_RESULT[input.result].label}）` : ""}${input.memo ? ` ${input.memo}` : ""}` },
      { label: "次回アクション", detail: input.next_action_date ? `${formatShortJa(input.next_action_date)} ${input.next_action || "連絡する"}` : "なし" },
      ...(input.status && input.status !== c.status ? [{ label: "ステータス", detail: `${COMPANY_STATUS[c.status].label} → ${COMPANY_STATUS[input.status].label}` }] : []),
    ];
    return proposal("activity", `営業の活動を記録する（${c.name}）`, rows, [], input);
  },
};

const proposeOffers: AiTool = {
  name: "propose_offers",
  label: "打診の確認カードを作っています",
  description:
    "現場の役割にスタッフを打診する（状態は「打診中」）確認カードを出す。staff_ids は find_candidates で確かめた人。打診の文面は現場の画面から送る（この確認カードでは送らない）。",
  schema: PAYLOAD.offers,
  run: async (ctx, input: z.infer<typeof PAYLOAD.offers>) => {
    const masters = await getMasters();
    const [{ data: ev }, { data: cands }] = await Promise.all([
      ctx.supabase.from("events").select("date, start_time, end_time, cancelled_at, venue:venues(name), client:companies(name)").eq("id", input.event_id).maybeSingle(),
      ctx.supabase.rpc("event_candidates", { p_event_id: input.event_id }),
    ]);
    if (!ev) throw new ToolInputError("その現場は見つかりません");
    if (ev.cancelled_at) throw new ToolInputError("中止の現場には打診できません");
    if (!masters.roleById.has(input.role_id)) throw new ToolInputError("役割の ID が違います");
    const byId = new Map((cands ?? []).map((c) => [c.staff_id, c]));
    const warnings: string[] = [];
    const rows = input.staff_ids.map((id) => {
      const c = byId.get(id);
      if (!c) return { label: id, detail: "", skip: "スタッフが見つかりません" };
      const notes = [
        !c.availability_submitted ? "稼働可能日が未提出" : c.availability === "ng" ? "この日は×" : c.availability === "maybe" ? "この日は△" : "",
        c.double_booking ? `同じ日に別の現場（${c.double_booking_venue}）` : "",
        c.ng_venue || c.ng_client ? `NG（${c.ng_reason}）` : "",
      ].filter(Boolean);
      if (notes.length) warnings.push(`${c.name}: ${notes.join("・")}`);
      return { label: c.name, detail: [c.rank_name, notes.join("・")].filter(Boolean).join(" / "), skip: c.current_status ? `すでにこの現場で「${ASSIGNMENT_STATUS[c.current_status].label}」` : undefined };
    });
    if (rows.every((r) => r.skip)) throw new ToolInputError(`打診できる人がいません: ${rows.map((r) => `${r.label} → ${r.skip}`).join(" / ")}`);
    const role = masters.roleById.get(input.role_id)!.name;
    const evLabel = `${formatShortJa(ev.date)} ${one(ev.venue)?.name ?? ""}（${one(ev.client)?.name ?? ""}）`;
    return proposal("offers", `${evLabel} の${role}に打診する（${rows.filter((r) => !r.skip).length}人）`, rows, warnings, input);
  },
};

const proposeEvents: AiTool = {
  name: "propose_events",
  label: "現場の確認カードを作っています",
  description:
    "現場を作る確認カードを出す（例: 取引先から LINE で来た依頼のスクショ）。client_id は取引先、venue_id は会場（search で確かめる。会場がまだないときは、先に会場の画面で登録してもらう）。dates は日付（複数なら同じ内容でまとめて作る）。requirements は役割ごとの必要人数。",
  schema: PAYLOAD.events,
  run: async (ctx, input: z.infer<typeof PAYLOAD.events>) => {
    const masters = await getMasters();
    const [{ data: client }, { data: venue }, { data: same }] = await Promise.all([
      ctx.supabase.from("companies").select("name, kind").eq("id", input.client_id).maybeSingle(),
      ctx.supabase.from("venues").select("name").eq("id", input.venue_id).maybeSingle(),
      ctx.supabase.from("events").select("date").eq("client_id", input.client_id).eq("venue_id", input.venue_id).in("date", input.dates).is("cancelled_at", null),
    ]);
    if (!client || client.kind !== "client") throw new ToolInputError("取引先の ID が違います（協力会社ではなく取引先を選んでください）");
    if (!venue) throw new ToolInputError("会場の ID が違います");
    for (const r of input.requirements) if (!masters.roleById.has(r.role_id)) throw new ToolInputError(`役割の ID（${r.role_id}）が違います`);
    if (input.dates.some((d) => d < addDays(ctx.today, -31))) throw new ToolInputError("1か月より前の現場は作れません");
    const dates = [...new Set(input.dates)].sort();
    const rows = [
      { label: "日付", detail: dates.map(formatShortJa).join("、") },
      { label: "取引先・会場", detail: `${client.name} / ${venue.name}` },
      { label: "時間", detail: input.start_time ? `${t5(input.start_time)}〜${t5(input.end_time)}` : "未定" },
      { label: "必要人数", detail: input.requirements.map((r) => `${masters.roleById.get(r.role_id)!.name} ${r.count}名`).join("・") },
      ...(input.meeting_time || input.meeting_place ? [{ label: "集合", detail: `${input.meeting_time ?? ""} ${input.meeting_place}`.trim() }] : []),
      ...(input.belongings ? [{ label: "持ち物", detail: input.belongings }] : []),
      ...(input.notes ? [{ label: "注意事項", detail: input.notes }] : []),
    ];
    const warnings = (same ?? []).length ? [`同じ取引先・会場の現場がすでにあります: ${(same ?? []).map((e) => formatShortJa(e.date)).join("、")}`] : [];
    return proposal("events", `現場を作る（${dates.length}件）`, rows, warnings, { ...input, dates });
  },
};

export const PROPOSAL_TOOLS: AiTool[] = [proposeReports, proposeAvailability, proposeActivity, proposeOffers, proposeEvents];

// ---------------------------------------------------------------------------
// 登録する（画面で「登録する」を押したとき）
// ---------------------------------------------------------------------------

export async function executeProposal(ctx: AiContext, kind: ProposalKind, raw: unknown): Promise<ActionResult<{ undo?: ProposalUndo }>> {
  const { supabase, user, today } = ctx;
  switch (kind) {
    case "reports": {
      const p = PAYLOAD.reports.safeParse(raw);
      if (!p.success) return fail("内容が正しくありません。もう一度 AI に頼んでください");
      const targets = await loadReportTargets(ctx, p.data.entries.map((e) => e.assignment_id));
      let done = 0;
      const skipped: string[] = [];
      for (const e of p.data.entries) {
        const a = targets.get(e.assignment_id);
        const why = reportSkip(a, today);
        if (why) {
          skipped.push(`${a?.staff?.name ?? ""}: ${why}`);
          continue;
        }
        const { error } = await supabase.from("reports").upsert({ assignment_id: e.assignment_id, submitted_at: new Date().toISOString(), source: "admin", comment: e.comment });
        if (error) return fail(dbErrorMessage(error));
        if (e.counts.length) {
          const { error: ie } = await supabase.from("report_items").upsert(e.counts.map((c) => ({ assignment_id: e.assignment_id, item_id: c.item_id, reported_count: c.count })));
          if (ie) return fail(dbErrorMessage(ie));
        }
        done++;
      }
      return ok(`${done}人分の報告を入れました${skipped.length ? `（入れなかった人: ${skipped.join(" / ")}）` : ""}。確定は「実績確認」で行ってください`);
    }
    case "availability": {
      const p = PAYLOAD.availability.safeParse(raw);
      if (!p.success) return fail("内容が正しくありません。もう一度 AI に頼んでください");
      const now = new Date().toISOString();
      const rows = p.data.entries.flatMap((e) => e.days.map((d) => ({ staff_id: e.staff_id, date: d.date, status: d.status, source: "admin" as const, updated_by: user.id, updated_at: now })));
      const { error } = await supabase.from("availability").upsert(rows);
      if (error) return fail(dbErrorMessage(error));
      return ok(`${p.data.entries.length}人分の稼働可能日を入れました`);
    }
    case "activity": {
      const p = PAYLOAD.activity.safeParse(raw);
      if (!p.success) return fail("内容が正しくありません。もう一度 AI に頼んでください");
      const { data: c } = await supabase.from("companies").select("status").eq("id", p.data.company_id).maybeSingle();
      if (!c) return fail("会社が見つかりません");
      const r = await recordActivity({ ...p.data, contact_id: null, status: p.data.status ?? c.status });
      if (!r.ok) return r;
      return ok(r.message, r.data ? { undo: { kind: "activity", id: r.data.id, before: r.data.before } } : undefined);
    }
    case "offers": {
      const p = PAYLOAD.offers.safeParse(raw);
      if (!p.success) return fail("内容が正しくありません。もう一度 AI に頼んでください");
      // すでにこの現場に入っている人は除く
      const { data: cur } = await supabase.from("assignments").select("staff_id").eq("event_id", p.data.event_id).in("staff_id", p.data.staff_ids);
      const inEvent = new Set((cur ?? []).map((a) => a.staff_id));
      const ids = p.data.staff_ids.filter((id) => !inEvent.has(id));
      if (!ids.length) return fail("打診できる人がいません（すでにこの現場に入っています）");
      const r = await offerStaff(p.data.event_id, p.data.role_id, ids);
      if (!r.ok) return r;
      return ok(`${r.message}。打診の文面は現場の画面から送ってください`, r.data ? { undo: { kind: "offers", ids: r.data.ids } } : undefined);
    }
    case "events": {
      const p = PAYLOAD.events.safeParse(raw);
      if (!p.success) return fail("内容が正しくありません。もう一度 AI に頼んでください");
      const v = p.data;
      const input = {
        client_id: v.client_id,
        venue_id: v.venue_id,
        start_time: v.start_time ?? "",
        end_time: v.end_time ?? "",
        meeting_time: v.meeting_time ?? "",
        meeting_place: v.meeting_place,
        belongings: v.belongings,
        notes: v.notes,
        requirements: v.requirements.map((r) => ({ role_id: r.role_id, required_count: r.count })),
      };
      const r = v.dates.length === 1 ? await createEvent(input, v.dates[0]) : await createEventsBulk(input, v.dates, "AI で作成");
      return r.ok ? ok(r.message) : r;
    }
  }
}
