import "server-only";
import { addDays, monthOf, monthRange } from "@/lib/date";
import { type ClientMoney, computeMoney, type MoneyInput, type MoneyResult, type Rate, type Rounding, type Split, type StaffMoney } from "@/lib/money";
import { selectAll } from "@/lib/supabase/select-all";
import { createClient } from "@/lib/supabase/server";

/**
 * ★ お金のデータ（オーナーだけ）。管理者のときは呼ばない（RLS でも 0 件になる）。
 */

export type MoneySettings = {
  taxRatePercent: number;
  taxRounding: Rounding;
  withholdingIncludeExpenses: boolean;
  withholdingTaxInclusive: boolean;
  /** 支払日（翌月の何日。0 = 末日） */
  paymentDay: number;
};

export const DEFAULT_MONEY_SETTINGS: MoneySettings = {
  taxRatePercent: 10,
  taxRounding: "floor",
  withholdingIncludeExpenses: true,
  withholdingTaxInclusive: true,
  paymentDay: 25,
};

export async function getMoneySettings(): Promise<MoneySettings> {
  const supabase = await createClient();
  const { data } = await supabase.from("owner_settings").select("key, value").in("key", ["consumption_tax", "withholding", "payment_day"]);
  const get = (k: string) => data?.find((r) => r.key === k)?.value as Record<string, unknown> | number | undefined;
  const tax = (get("consumption_tax") ?? {}) as { rate_percent?: number; rounding?: Rounding };
  const wh = (get("withholding") ?? {}) as { include_expenses?: boolean; tax_inclusive?: boolean };
  const day = get("payment_day");
  return {
    taxRatePercent: tax.rate_percent ?? DEFAULT_MONEY_SETTINGS.taxRatePercent,
    taxRounding: tax.rounding ?? DEFAULT_MONEY_SETTINGS.taxRounding,
    withholdingIncludeExpenses: wh.include_expenses ?? DEFAULT_MONEY_SETTINGS.withholdingIncludeExpenses,
    withholdingTaxInclusive: wh.tax_inclusive ?? DEFAULT_MONEY_SETTINGS.withholdingTaxInclusive,
    paymentDay: typeof day === "number" ? day : DEFAULT_MONEY_SETTINGS.paymentDay,
  };
}

type RateRow = { kind: Rate["kind"]; role_id: string | null; item_id: string | null; amount: number };
export const toRate = (r: RateRow): Rate => ({ kind: r.kind, roleId: r.role_id, itemId: r.item_id, amount: r.amount });

/** 取引先の請求設定と標準単価（取引先全体と、会場ごと） */
export async function getClientBilling(companyId: string) {
  const supabase = await createClient();
  const [{ data: billing }, { data: rates }] = await Promise.all([
    supabase.from("company_billing").select("bill_transport, invoice_note").eq("company_id", companyId).maybeSingle(),
    supabase.from("client_rates").select("kind, role_id, item_id, amount, venue_id, venue:venues(id, name)").eq("company_id", companyId),
  ]);
  const all = rates ?? [];
  const venues = new Map<string, { id: string; name: string; rates: Rate[] }>();
  for (const r of all.filter((x) => x.venue_id && x.venue)) {
    const v = venues.get(r.venue_id!) ?? { id: r.venue!.id, name: r.venue!.name, rates: [] };
    v.rates.push(toRate(r));
    venues.set(r.venue_id!, v);
  }
  return {
    billing: { billTransport: billing?.bill_transport ?? false, invoiceNote: billing?.invoice_note ?? "" },
    rates: all.filter((x) => !x.venue_id).map(toRate),
    venues: [...venues.values()].sort((a, b) => a.name.localeCompare(b.name, "ja")),
  };
}

/** インセンティブ単価（全体の標準） */
export async function getIncentiveRates(): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data } = await supabase.from("incentive_rates").select("item_id, amount");
  return new Map((data ?? []).map((r) => [r.item_id, r.amount]));
}

/**
 * 月（または1つの現場）の請求・支払いの計算に使う行をまとめて取る（★オーナーだけ）。
 * 計算は src/lib/money の computeMoney で行う。
 */
export async function loadMoneyInput(scope: { month: string } | { eventId: string }): Promise<MoneyInput> {
  const supabase = await createClient();
  const settings = await getMoneySettings();
  const range = "month" in scope ? monthRange(scope.month) : null;

  let evq = supabase
    .from("events")
    .select("id, date, client_id, venue_id, cancelled_at, report_required, client:companies(name), venue:venues(name)")
    .order("date")
    .order("id");
  evq = range ? evq.gte("date", range.start).lte("date", range.end) : evq.eq("id", (scope as { eventId: string }).eventId);
  const events = await selectAll((from, to) => evq.range(from, to));
  const eventIds = events.map((e) => e.id);
  const clientIds = [...new Set(events.map((e) => e.client_id))];
  // 現場のない月でも調整額は支払いに入れるので、月の指定なら続ける
  if (!eventIds.length && !range) return emptyInput(settings);

  const byEvents = <T>(make: (ids: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) =>
    chunked(eventIds, 200, make);

  const assignments = await byEvents((ids) =>
    supabase.from("assignments").select("id, event_id, staff_id, role_id, status, report:reports(confirmed_at)").in("event_id", ids),
  );
  const asgIds = assignments.map((a) => a.id);
  const staffIds = [...new Set(assignments.map((a) => a.staff_id))];
  const byAsg = <T>(make: (ids: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) => chunked(asgIds, 200, make);

  const [reportItems, expenses, overrides, eventRates, eventIncentives, clientRates, incentiveRates, billing, staffPrivate, staffNames, adjustments] =
    await Promise.all([
      byAsg((ids) => supabase.from("report_items").select("assignment_id, item_id, reported_count, confirmed_count").in("assignment_id", ids)),
      byAsg((ids) => supabase.from("expenses").select("assignment_id, staff_id, kind, amount, status").in("assignment_id", ids)),
      byAsg((ids) => supabase.from("assignment_private").select("assignment_id, daily_rate_override").in("assignment_id", ids)),
      byEvents((ids) => supabase.from("event_rates").select("event_id, kind, role_id, item_id, amount").in("event_id", ids)),
      byEvents((ids) => supabase.from("event_incentive_rates").select("event_id, item_id, amount").in("event_id", ids)),
      chunked(clientIds, 200, (ids) => supabase.from("client_rates").select("company_id, venue_id, kind, role_id, item_id, amount").in("company_id", ids)),
      supabase.from("incentive_rates").select("item_id, amount").then((r) => r.data ?? []),
      chunked(clientIds, 200, (ids) => supabase.from("company_billing").select("company_id, bill_transport").in("company_id", ids)),
      chunked(staffIds, 200, (ids) => supabase.from("staff_private").select("staff_id, base_daily_rate, withholding_method, invoice_number").in("staff_id", ids)),
      chunked(staffIds, 200, (ids) => supabase.from("staff").select("id, name").in("id", ids)),
      range
        ? supabase.from("payment_adjustments").select("id, staff_id, amount, reason").eq("month", range.start).then((r) => r.data ?? [])
        : Promise.resolve([] as { id: string; staff_id: string; amount: number; reason: string }[]),
    ]);

  const priv = new Map(staffPrivate.map((p) => [p.staff_id, p]));
  const adjStaff = adjustments.map((a) => a.staff_id).filter((id) => !staffIds.includes(id));
  const extraStaff = adjStaff.length
    ? await chunked([...new Set(adjStaff)], 200, (ids) =>
        supabase.from("staff").select("id, name, private:staff_private(base_daily_rate, withholding_method, invoice_number)").in("id", ids),
      )
    : [];

  return {
    events: events.map((e) => ({
      id: e.id,
      date: e.date,
      clientId: e.client_id,
      clientName: e.client?.name ?? "",
      venueId: e.venue_id,
      venueName: e.venue?.name ?? "",
      cancelled: e.cancelled_at != null,
      reportRequired: e.report_required,
    })),
    assignments: assignments.map((a) => ({
      id: a.id,
      eventId: a.event_id,
      staffId: a.staff_id,
      roleId: a.role_id,
      status: a.status,
      reportConfirmed: a.report?.confirmed_at != null,
    })),
    reportItems: reportItems.map((r) => ({ assignmentId: r.assignment_id, itemId: r.item_id, reported: r.reported_count, confirmed: r.confirmed_count })),
    expenses: expenses.map((x) => ({ assignmentId: x.assignment_id, staffId: x.staff_id, kind: x.kind, amount: x.amount, status: x.status })),
    clientRates: clientRates.map((r) => ({ companyId: r.company_id, venueId: r.venue_id, kind: r.kind, roleId: r.role_id, itemId: r.item_id, amount: r.amount })),
    eventRates: eventRates.map((r) => ({ eventId: r.event_id, kind: r.kind, roleId: r.role_id, itemId: r.item_id, amount: r.amount })),
    incentiveRates: incentiveRates.map((r) => ({ itemId: r.item_id, amount: r.amount })),
    eventIncentiveRates: eventIncentives.map((r) => ({ eventId: r.event_id, itemId: r.item_id, amount: r.amount })),
    staff: [
      ...staffNames.map((s) => {
        const p = priv.get(s.id);
        return { id: s.id, name: s.name, baseDailyRate: p?.base_daily_rate ?? null, method: p?.withholding_method ?? "none", invoiceNumber: p?.invoice_number ?? null };
      }),
      ...extraStaff.map((s) => {
        const p = Array.isArray(s.private) ? s.private[0] : s.private;
        return { id: s.id, name: s.name, baseDailyRate: p?.base_daily_rate ?? null, method: p?.withholding_method ?? "none", invoiceNumber: p?.invoice_number ?? null };
      }),
    ],
    dailyOverrides: overrides.filter((o) => o.daily_rate_override != null).map((o) => ({ assignmentId: o.assignment_id, amount: o.daily_rate_override! })),
    adjustments: adjustments.map((a) => ({ id: a.id, staffId: a.staff_id, amount: a.amount, reason: a.reason })),
    billing: billing.map((b) => ({ companyId: b.company_id, billTransport: b.bill_transport })),
    settings: {
      taxRatePercent: settings.taxRatePercent,
      taxRounding: settings.taxRounding,
      withholdingIncludeExpenses: settings.withholdingIncludeExpenses,
      withholdingTaxInclusive: settings.withholdingTaxInclusive,
    },
  };
}

function emptyInput(settings: MoneySettings): MoneyInput {
  return {
    events: [],
    assignments: [],
    reportItems: [],
    expenses: [],
    clientRates: [],
    eventRates: [],
    incentiveRates: [],
    eventIncentiveRates: [],
    staff: [],
    dailyOverrides: [],
    adjustments: [],
    billing: [],
    settings: {
      taxRatePercent: settings.taxRatePercent,
      taxRounding: settings.taxRounding,
      withholdingIncludeExpenses: settings.withholdingIncludeExpenses,
      withholdingTaxInclusive: settings.withholdingTaxInclusive,
    },
  };
}

/** in(...) に渡す ID が多いときは分けて取る（URL が長くなりすぎないように） */
async function chunked<T>(ids: string[], size: number, make: (ids: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) {
    const { data, error } = await make(ids.slice(i, i + size));
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
  }
  return out;
}

/** 月の請求・支払い・粗利（★オーナーだけ） */
export type ClosingStatus = "open" | "closed" | "unlocked";
export type PaymentState = { status: "unconfirmed" | "confirmed" | "paid"; paidOn: string | null };
export type MonthMoney = MoneyResult & {
  /** 締めの状態。closed のときは締めた時点のスナップショット */
  closing: ClosingStatus;
  snapshotAt: string | null;
  /** スタッフごとの支払いの状態（締めた月だけ行がある） */
  payments: Record<string, PaymentState>;
};

type Summary = MoneyResult["summary"];
const SNAPSHOT_VERSION = 1;

/** 締めるときに保存する形（src/lib/money の計算結果をそのまま残す） */
export function toSnapshot(r: MoneyResult) {
  return {
    summary: { v: SNAPSHOT_VERSION, ...r.summary },
    invoices: r.clients.map((c) => ({ company_id: c.id, subtotal: c.subtotal, tax: c.tax, total: c.total, detail: c })),
    payments: r.staff.map((x) => ({
      staff_id: x.id,
      daily_total: x.totals.daily,
      incentive_total: x.totals.incentive,
      adjustment_total: x.totals.adjustment,
      expense_total: x.totals.expense,
      withholding_base: x.totals.withholdingBase,
      withholding_amount: x.totals.withholding,
      net_amount: x.totals.net,
      detail: x,
    })),
  };
}

function summaryOf(json: unknown): Summary {
  const s = (json ?? {}) as Partial<Summary>;
  const zero = { confirmed: 0, estimate: 0 };
  return { revenue: s.revenue ?? zero, pay: s.pay ?? zero, gross: s.gross ?? zero, withholding: s.withholding ?? 0, net: s.net ?? 0 };
}

async function paymentStates(month: string): Promise<Record<string, PaymentState>> {
  const supabase = await createClient();
  const { data } = await supabase.from("payments").select("staff_id, status, paid_on").eq("month", `${month}-01`);
  return Object.fromEntries((data ?? []).map((p) => [p.staff_id, { status: p.status, paidOn: p.paid_on }]));
}

/** その月の請求・支払い・粗利。締めた月は締めた時点の金額、それ以外はいまのデータで計算する */
export async function getMonthMoney(month: string): Promise<MonthMoney> {
  const supabase = await createClient();
  const { data: mc } = await supabase.from("monthly_closings").select("status, summary, closed_at").eq("month", `${month}-01`).maybeSingle();
  if (mc?.status === "closed") {
    const [inv, pay] = await Promise.all([
      supabase.from("invoices").select("detail").eq("month", `${month}-01`),
      supabase.from("payments").select("staff_id, status, paid_on, detail").eq("month", `${month}-01`),
    ]);
    const clients = (inv.data ?? []).map((i) => i.detail as unknown as ClientMoney).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ja"));
    const staff = (pay.data ?? []).map((p) => p.detail as unknown as StaffMoney).sort((a, b) => b.totals.net - a.totals.net || a.name.localeCompare(b.name, "ja"));
    return {
      events: clients.flatMap((c) => c.events),
      clients,
      staff,
      summary: summaryOf(mc.summary),
      closing: "closed",
      snapshotAt: mc.closed_at,
      payments: Object.fromEntries((pay.data ?? []).map((p) => [p.staff_id, { status: p.status, paidOn: p.paid_on }])),
    };
  }
  const [result, payments] = await Promise.all([loadMoneyInput({ month }).then(computeMoney), paymentStates(month)]);
  return { ...result, closing: mc?.status ?? "open", snapshotAt: null, payments };
}

/** いまのデータで計算する（締めるときに使う。締めた月でもスナップショットは使わない） */
export async function computeMonthLive(month: string): Promise<MoneyResult> {
  return computeMoney(await loadMoneyInput({ month }));
}

export type TrendPoint = { month: string; revenue: Split; gross: Split };

/** 直近の月ごとの売上・粗利（指定した月を最後に n か月）。締めた月は締めた時点の数字 */
export async function getTrend(month: string, n = 12): Promise<TrendPoint[]> {
  const months: string[] = [];
  let m = month;
  for (let i = 0; i < n; i++) {
    months.unshift(m);
    m = monthOf(addDays(`${m}-01`, -1));
  }
  const supabase = await createClient();
  const { data } = await supabase.from("monthly_closings").select("month, summary").eq("status", "closed").in("month", months.map((x) => `${x}-01`));
  const closed = new Map((data ?? []).map((r) => [r.month.slice(0, 7), summaryOf(r.summary)]));
  const results = await Promise.all(months.map(async (mm) => closed.get(mm) ?? (await computeMonthLive(mm)).summary));
  return months.map((mm, i) => ({ month: mm, revenue: results[i].revenue, gross: results[i].gross }));
}

export type ClosingInfo = {
  status: ClosingStatus;
  closedAt: string | null;
  closedBy: string | null;
  logs: { action: "close" | "unlock" | "reclose"; reason: string; at: string; by: string | null }[];
};

/** 締めの状態と履歴 */
export async function getClosingInfo(month: string): Promise<ClosingInfo> {
  const supabase = await createClient();
  const [mc, logs] = await Promise.all([
    supabase.from("monthly_closings").select("status, closed_at, closed_by").eq("month", `${month}-01`).maybeSingle(),
    supabase.from("closing_logs").select("action, reason, created_at, user_id").eq("month", `${month}-01`).order("created_at", { ascending: false }),
  ]);
  const ids = [...new Set([mc.data?.closed_by, ...(logs.data ?? []).map((l) => l.user_id)].filter((x): x is string => Boolean(x)))];
  const { data: users } = ids.length ? await supabase.from("app_users").select("id, name").in("id", ids) : { data: [] };
  const name = new Map((users ?? []).map((u) => [u.id, u.name]));
  return {
    status: mc.data?.status ?? "open",
    closedAt: mc.data?.closed_at ?? null,
    closedBy: mc.data?.closed_by ? (name.get(mc.data.closed_by) ?? null) : null,
    logs: (logs.data ?? []).map((l) => ({ action: l.action, reason: l.reason, at: l.created_at, by: l.user_id ? (name.get(l.user_id) ?? null) : null })),
  };
}

export type ClosingChecklist = { unconfirmedEvents: number; unreported: number; pendingExpenses: number };

/** 締める前のチェック（実績が未確定の現場・未報告のアサイン・未承認の経費） */
export async function getClosingChecklist(month: string): Promise<ClosingChecklist> {
  const supabase = await createClient();
  const { start, end } = monthRange(month);
  const [ov, exp] = await Promise.all([
    selectAll((from, to) =>
      supabase
        .from("event_overview")
        .select("id, report_required, confirmed_total, unreported_count, unconfirmed_result_count")
        .gte("date", start)
        .lte("date", end)
        .is("cancelled_at", null)
        .order("id")
        .range(from, to),
    ),
    supabase
      .from("expenses")
      .select("id, assignment:assignments!inner(event:events!inner(date))", { count: "exact", head: true })
      .eq("status", "pending")
      .gte("assignment.event.date", start)
      .lte("assignment.event.date", end),
  ]);
  const evs = ov.filter((e) => e.report_required);
  return {
    unconfirmedEvents: evs.filter((e) => (e.confirmed_total ?? 0) > 0 && (e.unconfirmed_result_count ?? 0) > 0).length,
    unreported: evs.reduce((a, e) => a + (e.unreported_count ?? 0), 0),
    pendingExpenses: exp.count ?? 0,
  };
}

/** 月次目標（売上・粗利） */
export async function getTarget(month: string): Promise<{ revenue: number | null; grossProfit: number | null } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("monthly_targets").select("revenue, gross_profit").eq("month", `${month}-01`).maybeSingle();
  return data ? { revenue: data.revenue, grossProfit: data.gross_profit } : null;
}

/** 会場別の売上・粗利 */
export function byVenue(result: MoneyResult) {
  const m = new Map<string, { id: string; name: string; revenue: number; gross: number; events: number }>();
  for (const e of result.events) {
    if (e.cancelled) continue;
    const v = m.get(e.venueId) ?? { id: e.venueId, name: e.venueName, revenue: 0, gross: 0, events: 0 };
    v.revenue += e.bill.subtotal;
    v.gross += e.gross;
    v.events += 1;
    m.set(e.venueId, v);
  }
  return [...m.values()].sort((a, b) => b.revenue - a.revenue);
}
