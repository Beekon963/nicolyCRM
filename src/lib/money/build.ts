/**
 * DB から取った行をまとめて、月（または現場）の請求・支払い・粗利を計算する。
 * どの人を「稼働した」と数えるか、どの経費を入れるか、確定分か見込み分か、をここで決める。
 */
import { sumCounts } from "@/lib/count";
import { billEvent, type BillingEvent, type CountBasis, type EventBill, type ItemCount, invoiceTotals } from "./invoice";
import { type AssignmentPay, excludeTax, payAssignment, payStaffMonth, type StaffMonthPay, travelAllowance } from "./pay";
import { findIncentive, type Rate, type RateKind, type RateTable } from "./rates";
import type { Rounding } from "./round";
import { sum } from "./round";
import type { WithholdingMethod } from "./withholding";

export type MoneyInput = {
  events: { id: string; date: string; clientId: string; clientName: string; venueId: string; venueName: string; cancelled: boolean; reportRequired: boolean }[];
  assignments: { id: string; eventId: string; staffId: string; roleId: string; status: string; reportConfirmed: boolean }[];
  reportItems: { assignmentId: string; itemId: string; reported: number | null; confirmed: number | null }[];
  /** 経費（承認済み以外も渡してよい。承認済みだけ使う） */
  expenses: { assignmentId: string | null; staffId: string; kind: "transport" | "other"; amount: number; status: string }[];
  clientRates: { companyId: string; venueId: string | null; kind: RateKind; roleId: string | null; itemId: string | null; amount: number }[];
  eventRates: { eventId: string; kind: RateKind; roleId: string | null; itemId: string | null; amount: number }[];
  incentiveRates: { itemId: string; amount: number }[];
  eventIncentiveRates: { eventId: string; itemId: string; amount: number }[];
  /** baseDailyRate は人ごとの日当（決まった額と違う人だけ）、rankDailyRate はその人のランクの基準日当 */
  staff: {
    id: string;
    name: string;
    baseDailyRate: number | null;
    rankDailyRate?: number | null;
    /** ランクの名前（支払明細書の「業務委託報酬（ランクD）」に使う） */
    rankName?: string | null;
    method: WithholdingMethod;
    invoiceNumber: string | null;
  }[];
  dailyOverrides: { assignmentId: string; amount: number }[];
  /** 遠方の上乗せの回数（1時間30分を超える30分ごと。0 は渡さなくてよい） */
  travelSteps?: { assignmentId: string; steps: number }[];
  adjustments: { staffId: string; amount: number; reason: string; id?: string }[];
  billing: { companyId: string; billTransport: boolean }[];
  settings: {
    taxRatePercent: number;
    taxRounding: Rounding;
    withholdingIncludeExpenses: boolean;
    withholdingTaxInclusive: boolean;
    /** 遠方の上乗せの1回分の額（決まっていなければ null） */
    travelStepAmount?: number | null;
  };
};

export type Status = "confirmed" | "estimate";

export type EventMoney = {
  id: string;
  date: string;
  clientId: string;
  clientName: string;
  venueId: string;
  venueName: string;
  cancelled: boolean;
  /** 確定分（実績がすべて確定・記録のみ）か見込み分か */
  status: Status;
  bill: EventBill;
  /** この現場の報酬（日当 ＋ インセンティブ。税込） */
  reward: number;
  /** 請求しない交通費・経費 */
  unbilledExpenses: number;
  /** 承認済みの交通費・経費の合計 */
  expenses: number;
  gross: number;
};

export type ClientMoney = {
  id: string;
  name: string;
  events: EventMoney[];
  subtotal: number;
  tax: number;
  total: number;
  confirmedSubtotal: number;
  estimateSubtotal: number;
  missingRoles: string[];
};

export type StaffAssignmentMoney = {
  assignmentId: string;
  eventId: string;
  date: string;
  venueName: string;
  clientName: string;
  roleId: string;
  status: Status;
  worked: boolean;
  pay: AssignmentPay;
  expenses: number;
};

export type StaffMoney = {
  id: string;
  name: string;
  /** ランクの名前（Phase 13 より前に締めた月のスナップショットにはない） */
  rankName?: string | null;
  method: WithholdingMethod;
  invoiceRegistered: boolean;
  assignments: StaffAssignmentMoney[];
  adjustments: { amount: number; reason: string; id?: string }[];
  totals: StaffMonthPay;
  missingDailyRate: boolean;
  missingTravelRate: boolean;
};

export type Split = { confirmed: number; estimate: number };

export type MoneyResult = {
  events: EventMoney[];
  clients: ClientMoney[];
  staff: StaffMoney[];
  summary: { revenue: Split; pay: Split; gross: Split; withholding: number; net: number };
};

const WORKED = "confirmed";

export function computeMoney(input: MoneyInput): MoneyResult {
  const s = input.settings;
  const eventById = new Map(input.events.map((e) => [e.id, e]));
  const asgByEvent = group(input.assignments, (a) => a.eventId);
  const itemsByAsg = group(input.reportItems, (r) => r.assignmentId);
  const approved = input.expenses.filter((x) => x.status === "approved");
  const expByAsg = group(approved.filter((x) => x.assignmentId), (x) => x.assignmentId!);
  const billTransport = new Map(input.billing.map((b) => [b.companyId, b.billTransport]));
  const staffById = new Map(input.staff.map((x) => [x.id, x]));
  const override = new Map(input.dailyOverrides.map((d) => [d.assignmentId, d.amount]));
  const travelSteps = new Map((input.travelSteps ?? []).map((t) => [t.assignmentId, t.steps]));
  const globalIncentive = new Map(input.incentiveRates.map((r) => [r.itemId, r.amount]));
  const eventIncentive = new Map<string, Map<string, number>>();
  for (const r of input.eventIncentiveRates) {
    const m = eventIncentive.get(r.eventId) ?? new Map<string, number>();
    m.set(r.itemId, r.amount);
    eventIncentive.set(r.eventId, m);
  }
  const toRate = (r: { kind: RateKind; roleId: string | null; itemId: string | null; amount: number }): Rate => ({
    kind: r.kind,
    roleId: r.roleId,
    itemId: r.itemId,
    amount: r.amount,
  });

  const statusOf = (eventId: string): Status => {
    const ev = eventById.get(eventId);
    if (!ev || ev.cancelled || !ev.reportRequired) return "confirmed";
    const worked = (asgByEvent.get(eventId) ?? []).filter((a) => a.status === WORKED);
    return worked.every((a) => a.reportConfirmed) ? "confirmed" : "estimate";
  };
  const basisOf = (st: Status): CountBasis => (st === "confirmed" ? "confirmed" : "estimate");

  // アサインごとの支払い
  const payByAsg = new Map<string, AssignmentPay>();
  for (const a of input.assignments) {
    const ev = eventById.get(a.eventId);
    if (!ev) continue;
    const staff = staffById.get(a.staffId);
    const inc = eventIncentive.get(a.eventId);
    payByAsg.set(
      a.id,
      payAssignment(
        {
          worked: a.status === WORKED && !ev.cancelled,
          dailyRate: override.get(a.id) ?? staff?.baseDailyRate ?? staff?.rankDailyRate ?? null,
          travel: travelAllowance(travelSteps.get(a.id) ?? 0, s.travelStepAmount ?? null),
          items: (itemsByAsg.get(a.id) ?? []).map(toCount),
          incentiveRate: (itemId) => findIncentive(inc, globalIncentive, itemId),
        },
        basisOf(statusOf(a.eventId)),
      ),
    );
  }

  // 現場ごとの請求
  const events: EventMoney[] = input.events.map((ev) => {
    const asgs = asgByEvent.get(ev.id) ?? [];
    const st = statusOf(ev.id);
    const rates: RateTable = {
      event: input.eventRates.filter((r) => r.eventId === ev.id).map(toRate),
      clientVenue: input.clientRates.filter((r) => r.companyId === ev.clientId && r.venueId === ev.venueId).map(toRate),
      client: input.clientRates.filter((r) => r.companyId === ev.clientId && r.venueId == null).map(toRate),
    };
    const worked = asgs.filter((a) => a.status === WORKED);
    const items = mergeItems(worked.flatMap((a) => itemsByAsg.get(a.id) ?? []));
    const exps = asgs.flatMap((a) => expByAsg.get(a.id) ?? []);
    const transport = sum(exps.filter((x) => x.kind === "transport").map((x) => x.amount));
    const be: BillingEvent = { id: ev.id, cancelled: ev.cancelled, workers: worked.map((a) => ({ roleId: a.roleId })), items, transport };
    const bill = billEvent(be, rates, { billTransport: billTransport.get(ev.clientId) ?? false, basis: basisOf(st) });
    const reward = sum(asgs.map((a) => (payByAsg.get(a.id)?.daily ?? 0) + (payByAsg.get(a.id)?.incentive ?? 0)));
    const expenses = sum(exps.map((x) => x.amount));
    const unbilledExpenses = expenses - bill.billedTransport;
    const gross = bill.subtotal - bill.billedTransport - excludeTax(reward, s.taxRatePercent) - unbilledExpenses;
    return { ...ev, status: st, bill, reward, unbilledExpenses, expenses, gross };
  });

  // 取引先ごとの請求（月末締めで1か月分をまとめる）
  const clients: ClientMoney[] = [...group(events, (e) => e.clientId).entries()]
    .map(([id, evs]) => {
      const subtotal = sum(evs.map((e) => e.bill.subtotal));
      const t = invoiceTotals(subtotal, { ratePercent: s.taxRatePercent, rounding: s.taxRounding });
      return {
        id,
        name: evs[0].clientName,
        events: [...evs].sort((a, b) => a.date.localeCompare(b.date)),
        ...t,
        confirmedSubtotal: sum(evs.filter((e) => e.status === "confirmed").map((e) => e.bill.subtotal)),
        estimateSubtotal: sum(evs.filter((e) => e.status === "estimate").map((e) => e.bill.subtotal)),
        missingRoles: [...new Set(evs.flatMap((e) => e.bill.missingRoles))],
      };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ja"));

  // スタッフごとの支払い
  const adjByStaff = group(input.adjustments, (a) => a.staffId);
  const staffIds = new Set([...input.assignments.map((a) => a.staffId), ...input.adjustments.map((a) => a.staffId)]);
  const staff: StaffMoney[] = [...staffIds]
    .map((id) => {
      const info = staffById.get(id);
      const asgs: StaffAssignmentMoney[] = input.assignments
        .filter((a) => a.staffId === id && eventById.has(a.eventId))
        .map((a) => {
          const ev = eventById.get(a.eventId)!;
          return {
            assignmentId: a.id,
            eventId: ev.id,
            date: ev.date,
            venueName: ev.venueName,
            clientName: ev.clientName,
            roleId: a.roleId,
            status: statusOf(ev.id),
            worked: a.status === WORKED && !ev.cancelled,
            pay: payByAsg.get(a.id)!,
            expenses: sum((expByAsg.get(a.id) ?? []).map((x) => x.amount)),
          };
        })
        .filter((a) => a.worked || a.expenses)
        .sort((a, b) => a.date.localeCompare(b.date));
      const adjustments = (adjByStaff.get(id) ?? []).map(({ amount, reason, id: adjId }) => ({ amount, reason, id: adjId }));
      // 現場に付かない経費（アサインの指定がないもの）もスタッフの経費に入れる
      const loose = approved.filter((x) => x.staffId === id && !x.assignmentId).map((x) => x.amount);
      const totals = payStaffMonth(
        { method: info?.method ?? "none", assignments: asgs.map((a) => a.pay), expenses: [...asgs.map((a) => a.expenses), ...loose], adjustments: adjustments.map((a) => a.amount) },
        { includeExpenses: s.withholdingIncludeExpenses, taxInclusive: s.withholdingTaxInclusive, taxRatePercent: s.taxRatePercent },
      );
      return {
        id,
        name: info?.name ?? "",
        rankName: info?.rankName ?? null,
        method: info?.method ?? "none",
        invoiceRegistered: Boolean(info?.invoiceNumber),
        assignments: asgs,
        adjustments,
        totals,
        missingDailyRate: asgs.some((a) => a.pay.missingDailyRate),
        missingTravelRate: asgs.some((a) => a.pay.missingTravelRate),
      };
    })
    .filter((x) => x.assignments.length || x.adjustments.length)
    .sort((a, b) => b.totals.net - a.totals.net || a.name.localeCompare(b.name, "ja"));

  // 月の数字（確定分 / 見込み分）。調整額・現場に付かない経費は確定分に入れる
  const split = (st: Status) => events.filter((e) => e.status === st);
  const adjTotal = sum(input.adjustments.map((a) => a.amount));
  const looseExp = sum(approved.filter((x) => !x.assignmentId).map((x) => x.amount));
  const bucket = (st: Status) => {
    const evs = split(st);
    const extraReward = st === "confirmed" ? adjTotal : 0;
    const extraExp = st === "confirmed" ? looseExp : 0;
    const revenue = sum(evs.map((e) => e.bill.subtotal));
    const reward = sum(evs.map((e) => e.reward)) + extraReward;
    const expenses = sum(evs.map((e) => e.expenses)) + extraExp;
    const billed = sum(evs.map((e) => e.bill.billedTransport));
    return { revenue, pay: reward + expenses, gross: revenue - billed - excludeTax(reward, s.taxRatePercent) - (expenses - billed) };
  };
  const c = bucket("confirmed");
  const e = bucket("estimate");
  return {
    events,
    clients,
    staff,
    summary: {
      revenue: { confirmed: c.revenue, estimate: e.revenue },
      pay: { confirmed: c.pay, estimate: e.pay },
      gross: { confirmed: c.gross, estimate: e.gross },
      withholding: sum(staff.map((x) => x.totals.withholding)),
      net: sum(staff.map((x) => x.totals.net)),
    },
  };
}

function toCount(r: { itemId: string; reported: number | null; confirmed: number | null }): ItemCount {
  return { itemId: r.itemId, reported: r.reported, confirmed: r.confirmed };
}

/** 現場の全員の件数を項目ごとに足す（null は null のまま。どちらかに数があれば数として足す） */
function mergeItems(rows: { itemId: string; reported: number | null; confirmed: number | null }[]): ItemCount[] {
  const m = new Map<string, ItemCount>();
  for (const r of rows) {
    const cur = m.get(r.itemId) ?? { itemId: r.itemId, reported: null, confirmed: null };
    // 件数は小数第2位まであるので、足し算の誤差が出ないようにそろえる（Phase 11）
    if (r.reported != null) cur.reported = sumCounts([cur.reported, r.reported]);
    if (r.confirmed != null) cur.confirmed = sumCounts([cur.confirmed, r.confirmed]);
    m.set(r.itemId, cur);
  }
  return [...m.values()];
}

function group<T, K>(rows: T[], key: (r: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}
