import "server-only";
import { z } from "zod";
import type { AppUser } from "@/lib/auth";
import { addDays } from "@/lib/date";
import { loadDailyReports } from "@/lib/data/daily-report";
import { getMasters } from "@/lib/data/masters";
import { getMonthMoney } from "@/lib/data/money";
import { ACTIVITY_KIND, ACTIVITY_RESULT, ASSIGNMENT_STATUS, AVAILABILITY, COMPANY_KIND, COMPANY_STATUS, NOTE_KIND, PRIORITY, STAFF_STATUS } from "@/lib/labels";
import { renderReport } from "@/lib/report-format";
import { digitsOnly, orLike, searchNorm } from "@/lib/search";
import { type AiContext, type AiTool, checkRange, dateArg, day, one, t5, ToolInputError } from "./common";
import { PROPOSAL_TOOLS, type Proposal } from "./proposals";
import { sumCounts } from "@/lib/count";

/**
 * AI アシスタントが使う道具（Phase 4-4）。
 * - すべてログイン中の人の権限（RLS）で読む。秘密キーは使わない
 * - ★ 金額の道具（money_month）はオーナーにだけ渡す。管理者は金額のテーブルを読めない（RLS）うえ、道具自体を渡さない
 * - 電話番号・住所・口座・マイページの鍵は返さない（AI に渡す個人情報を減らす。必要なら画面で見てもらう）
 * - 登録・変更は propose_*（./proposals）で確認カードを出すだけ。実際の登録は、画面で「登録する」を押したときに行う
 */

export type ToolOutcome = { content: string; isError?: boolean; proposal?: Proposal };

const search: AiTool = {
  name: "search",
  label: "名前を探しています",
  description:
    "スタッフ・会社（取引先・協力会社）・先方の担当者・会場を名前やかな・LINE の表示名の一部で探す。ひらがな / カタカナの違いは吸収する。ID が必要なときは必ずこれで確かめる。名字だけ・下の名前だけでも探せる。",
  schema: z.object({ q: z.string().min(1).max(50).describe("探す言葉（名前の一部など）") }),
  run: async ({ supabase }, { q }: { q: string }) => {
    const norm = searchNorm(q);
    const digits = digitsOnly(q);
    const textOr = (extra: string[] = []) => [orLike(["search_text"], norm), ...extra].join(",");
    const [staff, companies, contacts, venues] = await Promise.all([
      supabase
        .from("staff")
        .select("id, name, kana, line_name, status, nearest_station, rank:ranks(name)")
        .or(textOr([orLike(["line_name"], q.trim()), ...(digits.length >= 4 ? [orLike(["phone_digits"], digits)] : [])]))
        .order("status")
        .limit(15),
      supabase.from("companies").select("id, name, kind, status").or(textOr()).limit(10),
      supabase.from("contacts").select("name, title, company:companies(id, name)").or(textOr()).limit(10),
      supabase.from("venues").select("id, name, nearest_station, is_active").or(textOr()).limit(10),
    ]);
    return {
      staff: (staff.data ?? []).map((s) => ({
        staff_id: s.id,
        name: s.name,
        kana: s.kana,
        line_name: s.line_name || undefined,
        status: STAFF_STATUS[s.status].label,
        rank: one(s.rank)?.name,
        nearest_station: s.nearest_station || undefined,
      })),
      companies: (companies.data ?? []).map((c) => ({ company_id: c.id, name: c.name, kind: COMPANY_KIND[c.kind], status: COMPANY_STATUS[c.status].label })),
      contacts: (contacts.data ?? []).map((c) => ({ name: c.name, title: c.title, company: one(c.company)?.name, company_id: one(c.company)?.id })),
      venues: (venues.data ?? []).map((v) => ({ venue_id: v.id, name: v.name, nearest_station: v.nearest_station || undefined, active: v.is_active })),
    };
  },
};

const listEvents: AiTool = {
  name: "list_events",
  label: "現場を調べています",
  description:
    "期間の現場（日付・時間・取引先・会場・役割ごとの必要人数と確定 / 打診中の人数・欠員・入っているスタッフと状態）。取引先・会場・スタッフで絞れる。欠員だけにもできる。期間は62日まで。",
  schema: z.object({
    from: dateArg,
    to: dateArg,
    client_id: z.uuid().optional(),
    venue_id: z.uuid().optional(),
    staff_id: z.uuid().optional().describe("このスタッフが入っている（打診中を含む）現場だけ"),
    shortage_only: z.boolean().optional().describe("欠員のある現場だけ"),
  }),
  run: async ({ supabase }, f: { from: string; to: string; client_id?: string; venue_id?: string; staff_id?: string; shortage_only?: boolean }) => {
    checkRange(f.from, f.to, 62);
    const masters = await getMasters();
    let q = supabase
      .from("events")
      .select(
        "id, date, start_time, end_time, cancelled_at, client_id, venue_id, client:companies(name), venue:venues(name), event_requirements(role_id, required_count), assignments(id, staff_id, role_id, status, staff:staff(name))",
      )
      .gte("date", f.from)
      .lte("date", f.to)
      .order("date")
      .order("start_time", { nullsFirst: false })
      .limit(200);
    if (f.client_id) q = q.eq("client_id", f.client_id);
    if (f.venue_id) q = q.eq("venue_id", f.venue_id);
    const { data, error } = await q;
    if (error) throw new Error("現場を読めませんでした");
    const rows = (data ?? [])
      .filter((e) => !f.staff_id || e.assignments.some((a) => a.staff_id === f.staff_id && ["offered", "confirmed", "waitlisted"].includes(a.status)))
      .map((e) => {
        const roles = e.event_requirements.map((r) => {
          const asg = e.assignments.filter((a) => a.role_id === r.role_id);
          const confirmed = asg.filter((a) => a.status === "confirmed").length;
          return { role: masters.roleById.get(r.role_id)?.name ?? "", role_id: r.role_id, required: r.required_count, confirmed, offered: asg.filter((a) => a.status === "offered").length };
        });
        const shortage = e.cancelled_at ? 0 : roles.reduce((s, r) => s + Math.max(r.required - r.confirmed, 0), 0);
        return {
          event_id: e.id,
          date: day(e.date),
          time: e.start_time ? `${t5(e.start_time)}〜${t5(e.end_time)}` : "",
          client: one(e.client)?.name,
          client_id: e.client_id,
          venue: one(e.venue)?.name,
          venue_id: e.venue_id,
          cancelled: e.cancelled_at ? true : undefined,
          roles,
          shortage,
          staff: e.assignments
            .filter((a) => a.status !== "declined")
            .map((a) => ({ name: one(a.staff)?.name, staff_id: a.staff_id, assignment_id: a.id, role: masters.roleById.get(a.role_id)?.name, status: ASSIGNMENT_STATUS[a.status].label })),
        };
      })
      .filter((e) => !f.shortage_only || e.shortage > 0);
    return { count: rows.length, events: rows };
  },
};

const getEvent: AiTool = {
  name: "get_event",
  label: "現場を調べています",
  description: "1つの現場の詳しい情報（集合時刻・集合場所・持ち物・注意事項・入っている人と報告の状況・件数）。",
  schema: z.object({ event_id: z.uuid() }),
  run: async ({ supabase }, { event_id }: { event_id: string }) => {
    const masters = await getMasters();
    const { data: e } = await supabase
      .from("events")
      .select(
        "id, date, start_time, end_time, meeting_time, meeting_place, belongings, notes, cancelled_at, cancel_reason, client:companies(id, name), venue:venues(id, name, nearest_station), event_requirements(role_id, required_count), assignments(id, staff_id, role_id, status, confirm_notice_sent_at, reminder_sent_at, staff:staff(name), report:reports(submitted_at, confirmed_at, comment), report_items(item_id, reported_count, confirmed_count))",
      )
      .eq("id", event_id)
      .maybeSingle();
    if (!e) throw new ToolInputError("その現場は見つかりません");
    return {
      event_id: e.id,
      date: day(e.date),
      time: e.start_time ? `${t5(e.start_time)}〜${t5(e.end_time)}` : "",
      meeting: [t5(e.meeting_time), e.meeting_place].filter(Boolean).join(" "),
      belongings: e.belongings,
      notes: e.notes,
      cancelled: e.cancelled_at ? `中止（${e.cancel_reason}）` : undefined,
      client: one(e.client),
      venue: one(e.venue),
      requirements: e.event_requirements.map((r) => ({ role: masters.roleById.get(r.role_id)?.name, role_id: r.role_id, required: r.required_count })),
      staff: e.assignments.map((a) => {
        const r = one(a.report);
        return {
          name: one(a.staff)?.name,
          staff_id: a.staff_id,
          assignment_id: a.id,
          role: masters.roleById.get(a.role_id)?.name,
          status: ASSIGNMENT_STATUS[a.status].label,
          confirm_notice_sent: a.status === "confirmed" ? Boolean(a.confirm_notice_sent_at) : undefined,
          report: r?.confirmed_at ? "確定済み" : r?.submitted_at ? "報告済み（未確定）" : a.status === "confirmed" ? "未報告" : undefined,
          counts: a.report_items
            .filter((i) => i.reported_count != null || i.confirmed_count != null)
            .map((i) => ({ item: masters.itemById.get(i.item_id)?.name, count: i.confirmed_count ?? i.reported_count })),
          comment: r?.comment || undefined,
        };
      }),
    };
  },
};

const getStaff: AiTool = {
  name: "get_staff",
  label: "スタッフを調べています",
  description:
    "スタッフ1人の情報（ランク・役割・エリア・最寄り駅・状態・メモ・稼働履歴メモ）と、これからの予定、稼働可能日（今日から45日）、直近3か月の確定件数。電話番号・住所・口座は返さない。",
  schema: z.object({ staff_id: z.uuid() }),
  run: async ({ supabase, today }, { staff_id }: { staff_id: string }) => {
    const masters = await getMasters();
    const until = addDays(today, 45);
    const since = addDays(today, -92);
    const [{ data: s }, { data: notes }, { data: avail }, { data: asg }] = await Promise.all([
      supabase.from("staff").select("id, name, kana, line_name, status, nearest_station, memo, rank_id, staff_roles(role_id), staff_areas(area_id)").eq("id", staff_id).maybeSingle(),
      supabase.from("staff_notes").select("date, kind, memo").eq("staff_id", staff_id).order("date", { ascending: false }).limit(10),
      supabase.from("availability").select("date, status").eq("staff_id", staff_id).gte("date", today).lte("date", until).order("date"),
      supabase
        .from("assignments")
        .select("status, role_id, event:events!inner(date, start_time, end_time, client:companies(name), venue:venues(name)), report_items(item_id, reported_count, confirmed_count)")
        .eq("staff_id", staff_id)
        .gte("event.date", since)
        .lte("event.date", until),
    ]);
    if (!s) throw new ToolInputError("そのスタッフは見つかりません");
    const rows = (asg ?? []).map((a) => ({ ...a, ev: one(a.event)! })).filter((a) => a.ev);
    const totals = new Map<string, number>();
    for (const a of rows.filter((a) => a.status === "confirmed" && a.ev.date < today))
      for (const i of a.report_items) {
        const n = i.confirmed_count ?? i.reported_count ?? 0;
        const name = masters.itemById.get(i.item_id)?.name ?? "";
        totals.set(name, sumCounts([totals.get(name), n]));
      }
    const worked = rows.filter((a) => a.status === "confirmed" && a.ev.date < today);
    return {
      staff_id: s.id,
      name: s.name,
      kana: s.kana,
      line_name: s.line_name || undefined,
      status: STAFF_STATUS[s.status].label,
      rank: s.rank_id ? masters.rankById.get(s.rank_id)?.name : undefined,
      roles: s.staff_roles.map((r) => masters.roleById.get(r.role_id)?.name),
      areas: s.staff_areas.map((a) => masters.areaById.get(a.area_id)?.name),
      nearest_station: s.nearest_station,
      memo: s.memo || undefined,
      notes: (notes ?? []).map((n) => `${n.date} ${NOTE_KIND[n.kind].label} ${n.memo}`),
      upcoming: rows
        .filter((a) => a.ev.date >= today && ["offered", "confirmed", "waitlisted"].includes(a.status))
        .sort((a, b) => a.ev.date.localeCompare(b.ev.date))
        .map((a) => ({ date: day(a.ev.date), client: one(a.ev.client)?.name, venue: one(a.ev.venue)?.name, role: masters.roleById.get(a.role_id)?.name, status: ASSIGNMENT_STATUS[a.status].label })),
      availability: (avail ?? []).map((a) => `${a.date} ${AVAILABILITY[a.status].mark}`),
      last_3_months: { worked_days: worked.length, counts: Object.fromEntries(totals) },
    };
  },
};

const findCandidates: AiTool = {
  name: "find_candidates",
  label: "候補を探しています",
  description:
    "現場に入れる候補のスタッフ（おすすめ順）。稼働可能日（○△×・未提出）、ランク、役割、同じ日の別の現場、NG（会場・取引先）、平均獲得件数を返す。打診するときはこの結果から選ぶ。",
  schema: z.object({ event_id: z.uuid(), role_id: z.uuid().optional().describe("この役割ができる人だけ") }),
  run: async ({ supabase }, { event_id, role_id }: { event_id: string; role_id?: string }) => {
    const { data, error } = await supabase.rpc("event_candidates", { p_event_id: event_id });
    if (error) throw new ToolInputError("その現場の候補を出せません");
    const rows = (data ?? []).filter((c) => !role_id || c.role_ids.includes(role_id));
    return {
      candidates: rows.slice(0, 30).map((c) => ({
        staff_id: c.staff_id,
        name: c.name,
        rank: c.rank_name,
        availability: c.availability_submitted ? AVAILABILITY[c.availability ?? "none"]?.label : "未提出",
        already_in_this_event: c.current_status ? ASSIGNMENT_STATUS[c.current_status].label : undefined,
        double_booking: c.double_booking ? `同じ日に別の現場（${c.double_booking_venue}）` : undefined,
        ng: c.ng_venue || c.ng_client ? `NG（${c.ng_reason}）` : undefined,
        area_match: c.area_match,
        avg_count: c.avg_confirmed,
        cautions: c.caution_count || undefined,
      })),
      more: Math.max(rows.length - 30, 0),
    };
  },
};

const availabilityOn: AiTool = {
  name: "availability_on",
  label: "稼働可能日を調べています",
  description: "その日に稼働できる（○）・調整すれば可（△）のスタッフと、その日すでに現場に入っている人。",
  schema: z.object({ date: dateArg }),
  run: async ({ supabase }, { date }: { date: string }) => {
    const [{ data: avail }, { data: busy }] = await Promise.all([
      supabase.from("availability").select("status, staff:staff!inner(id, name, status)").eq("date", date).in("status", ["ok", "maybe"]).eq("staff.status", "active"),
      supabase.from("assignments").select("staff_id, status, event:events!inner(date)").eq("event.date", date).in("status", ["offered", "confirmed"]),
    ]);
    const busyIds = new Set((busy ?? []).map((b) => b.staff_id));
    const list = (st: "ok" | "maybe") =>
      (avail ?? [])
        .filter((a) => a.status === st)
        .map((a) => one(a.staff)!)
        .map((s) => ({ staff_id: s.id, name: s.name, already_assigned: busyIds.has(s.id) || undefined }));
    return { date: day(date), ok: list("ok"), maybe: list("maybe") };
  },
};

const results: AiTool = {
  name: "results",
  label: "実績を調べています",
  description:
    "期間の実績（獲得件数）。現場・スタッフごとの件数（確定があれば確定、なければ速報）と、報告の状況（未報告・未確定）、項目ごとの合計。取引先・スタッフ・会場で絞れる。期間は93日まで。",
  schema: z.object({ from: dateArg, to: dateArg, client_id: z.uuid().optional(), staff_id: z.uuid().optional(), venue_id: z.uuid().optional() }),
  run: async ({ supabase }, f: { from: string; to: string; client_id?: string; staff_id?: string; venue_id?: string }) => {
    checkRange(f.from, f.to, 93);
    const masters = await getMasters();
    let q = supabase
      .from("assignments")
      .select(
        "id, staff_id, role_id, staff:staff(name), event:events!inner(id, date, client_id, venue_id, cancelled_at, client:companies(name), venue:venues(name)), report:reports(submitted_at, confirmed_at), report_items(item_id, reported_count, confirmed_count)",
      )
      .eq("status", "confirmed")
      .gte("event.date", f.from)
      .lte("event.date", f.to)
      .is("event.cancelled_at", null)
      .limit(1000);
    if (f.client_id) q = q.eq("event.client_id", f.client_id);
    if (f.venue_id) q = q.eq("event.venue_id", f.venue_id);
    if (f.staff_id) q = q.eq("staff_id", f.staff_id);
    const { data } = await q;
    const totals = new Map<string, number>();
    const rows = (data ?? [])
      .map((a) => ({ ...a, ev: one(a.event)!, rep: one(a.report) }))
      .sort((a, b) => a.ev.date.localeCompare(b.ev.date))
      .map((a) => {
        const counts: Record<string, number> = {};
        for (const i of a.report_items) {
          const n = i.confirmed_count ?? i.reported_count;
          if (n == null) continue;
          const name = masters.itemById.get(i.item_id)?.name ?? "";
          counts[name] = n;
          totals.set(name, sumCounts([totals.get(name), n]));
        }
        return {
          date: day(a.ev.date),
          client: one(a.ev.client)?.name,
          venue: one(a.ev.venue)?.name,
          staff: one(a.staff)?.name,
          role: masters.roleById.get(a.role_id)?.name,
          report: a.rep?.confirmed_at ? "確定" : a.rep?.submitted_at ? "速報" : "未報告",
          counts,
        };
      });
    return { rows: rows.slice(0, 300), more: Math.max(rows.length - 300, 0), totals: Object.fromEntries(totals), unreported: rows.filter((r) => r.report === "未報告").length };
  },
};

const dailyReport: AiTool = {
  name: "daily_report",
  label: "日報を作っています",
  description: "その日の日報の文章（取引先ごとの日報のフォーマットで作ったもの。LINE に貼れる）。取引先で絞れる。未報告の人は（未報告）と出る。",
  schema: z.object({ date: dateArg, client_id: z.uuid().optional() }),
  run: async (_ctx, { date, client_id }: { date: string; client_id?: string }) => {
    const clients = (await loadDailyReports(date)).filter((c) => !client_id || c.id === client_id);
    return {
      date: day(date),
      clients: clients.map((c) => ({
        client: c.name,
        reported: `${c.reported}/${c.total}人が報告済み`,
        texts: c.formats.map((f) => ({ format: f.name, text: renderReport(f, c.day) })),
      })),
    };
  },
};

const sales: AiTool = {
  name: "sales",
  label: "営業を調べています",
  description:
    "会社（取引先・協力会社）の一覧と営業の状態（ステータス・優先度・次回アクション日と内容・最後の活動）。次回アクションが今日以前のもの（やること）だけにもできる。",
  schema: z.object({
    kind: z.enum(["client", "partner"]).optional().describe("client=取引先、partner=協力会社"),
    due_only: z.boolean().optional().describe("次回アクションが今日以前・未設定の会社だけ"),
  }),
  run: async ({ supabase, today }, f: { kind?: "client" | "partner"; due_only?: boolean }) => {
    let q = supabase
      .from("companies")
      .select("id, name, kind, status, priority, next_action_date, next_action, activities(occurred_at, kind, memo)")
      .eq("is_active", true)
      .order("next_action_date", { nullsFirst: true })
      .order("occurred_at", { referencedTable: "activities", ascending: false })
      .limit(1, { referencedTable: "activities" })
      .limit(200);
    if (f.kind) q = q.eq("kind", f.kind);
    const { data } = await q;
    const rows = (data ?? [])
      .filter((c) => !f.due_only || !c.next_action_date || c.next_action_date <= today)
      .map((c) => {
        const last = c.activities[0];
        return {
          company_id: c.id,
          name: c.name,
          kind: COMPANY_KIND[c.kind],
          status: COMPANY_STATUS[c.status].label,
          priority: PRIORITY[c.priority],
          next: c.next_action_date ? `${c.next_action_date} ${c.next_action}` : "未設定",
          last_activity: last ? `${last.occurred_at.slice(0, 10)} ${ACTIVITY_KIND[last.kind]} ${last.memo.slice(0, 60)}` : undefined,
        };
      });
    return { count: rows.length, companies: rows };
  },
};

const getCompany: AiTool = {
  name: "get_company",
  label: "会社を調べています",
  description: "会社1社の営業の情報（ステータス・次回アクション・先方の担当者の名前と役職・最近の活動10件・これからの現場）。電話番号・金額は返さない。",
  schema: z.object({ company_id: z.uuid() }),
  run: async ({ supabase, today }, { company_id }: { company_id: string }) => {
    const [{ data: c }, { data: acts }, { data: evs }] = await Promise.all([
      supabase.from("companies").select("id, name, kind, status, priority, next_action_date, next_action, memo, contacts(id, name, title, is_active)").eq("id", company_id).maybeSingle(),
      supabase.from("activities").select("occurred_at, kind, result, memo, next_action").eq("company_id", company_id).order("occurred_at", { ascending: false }).limit(10),
      supabase.from("events").select("date, venue:venues(name)").eq("client_id", company_id).gte("date", today).is("cancelled_at", null).order("date").limit(20),
    ]);
    if (!c) throw new ToolInputError("その会社は見つかりません");
    return {
      company_id: c.id,
      name: c.name,
      kind: COMPANY_KIND[c.kind],
      status: COMPANY_STATUS[c.status].label,
      priority: PRIORITY[c.priority],
      next: c.next_action_date ? `${c.next_action_date} ${c.next_action}` : "未設定",
      memo: c.memo || undefined,
      contacts: c.contacts.filter((x) => x.is_active).map((x) => ({ contact_id: x.id, name: x.name, title: x.title })),
      activities: (acts ?? []).map((a) => `${a.occurred_at.slice(0, 10)} ${ACTIVITY_KIND[a.kind]}${a.result ? `（${ACTIVITY_RESULT[a.result].label}）` : ""} ${a.memo}`),
      upcoming_events: (evs ?? []).map((e) => `${day(e.date)} ${one(e.venue)?.name ?? ""}`),
    };
  },
};

const moneyMonth: AiTool = {
  name: "money_month",
  label: "お金を調べています",
  ownerOnly: true,
  description: "（オーナーだけ）月の売上・支払・粗利（確定分と見込み）、取引先ごとの請求額、スタッフごとの報酬と支払額、締めの状態。金額は円（税抜の請求額は subtotal）。",
  schema: z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "月は YYYY-MM の形で入れてください") }),
  run: async ({ user }, { month }: { month: string }) => {
    if (user.role !== "owner") throw new ToolInputError("金額はオーナーだけが見られます");
    const m = await getMonthMoney(month);
    return {
      month,
      closing: m.closing === "closed" ? "締め済み" : m.closing === "unlocked" ? "ロック解除中" : "締めていない",
      summary: m.summary,
      clients: m.clients.map((c) => ({ name: c.name, subtotal: c.subtotal, tax: c.tax, total: c.total })),
      staff: m.staff.map((s) => ({ name: s.name, reward: s.totals.reward, expense: s.totals.expense, withholding: s.totals.withholding, net: s.totals.net })),
    };
  },
};

export const READ_TOOLS: AiTool[] = [search, listEvents, getEvent, getStaff, findCandidates, availabilityOn, results, dailyReport, sales, getCompany, moneyMonth];

/** その人に渡す道具（★ 管理者には金額の道具を渡さない） */
export function toolsFor(user: AppUser): AiTool[] {
  return [...READ_TOOLS, ...PROPOSAL_TOOLS].filter((t) => !t.ownerOnly || user.role === "owner");
}

/** Claude に渡す形（JSON Schema） */
export function toolDefinitions(tools: AiTool[]) {
  return tools.map((t) => {
    const { $schema: _omit, ...schema } = z.toJSONSchema(t.schema) as Record<string, unknown>;
    void _omit;
    return { name: t.name, description: t.description, input_schema: schema as { type: "object"; [k: string]: unknown } };
  });
}

/** 道具を使う。入力の誤りは AI に返して直してもらう。権限のない道具は使わせない */
export async function runTool(ctx: AiContext, tools: AiTool[], name: string, input: unknown): Promise<ToolOutcome> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { content: "その道具は使えません", isError: true };
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) return { content: `入力が正しくありません: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join(" / ")}`, isError: true };
  try {
    const out = await tool.run(ctx, parsed.data as never);
    if (out && typeof out === "object" && "proposal" in out) {
      const p = (out as { proposal: Proposal }).proposal;
      return {
        content: `確認カード「${p.title}」を画面に出しました（まだ登録していません）。利用者が内容を確かめて「登録する」を押すと登録されます。`,
        proposal: p,
      };
    }
    return { content: JSON.stringify(out) };
  } catch (e) {
    if (e instanceof ToolInputError) return { content: e.message, isError: true };
    return { content: "調べられませんでした。時間をおいてもう一度試してください。", isError: true };
  }
}

