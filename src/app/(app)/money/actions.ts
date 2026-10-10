"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * ★ お金の設定（オーナーだけ）。RLS でもオーナー以外は書けないが、ここでも必ず確かめる。
 */

const yen = z.number().int("金額は整数（円）で入れてください").min(0, "金額は0円以上で入れてください").max(100_000_000, "金額が大きすぎます");

const rateRow = z.object({
  kind: z.enum(["per_person_day", "per_event", "per_item"]),
  roleId: z.uuid().nullable(),
  itemId: z.uuid().nullable(),
  /** null は「未設定（標準を使う）」 */
  amount: yen.nullable(),
});
export type RateInput = z.input<typeof rateRow>;

function rowsFor(rows: z.output<typeof rateRow>[]) {
  return rows
    .filter((r) => r.amount != null)
    .map((r) => ({
      kind: r.kind,
      role_id: r.kind === "per_person_day" ? r.roleId : null,
      item_id: r.kind === "per_item" ? r.itemId : null,
      amount: r.amount!,
    }));
}

function refresh(companyId?: string, eventId?: string) {
  if (companyId) revalidatePath(`/sales/${companyId}`);
  if (eventId) revalidatePath(`/events/${eventId}`, "layout");
  revalidatePath("/money", "layout");
}

/** 取引先の請求設定（交通費を請求に含めるか・請求書の送付先メモ） */
export async function saveClientBilling(companyId: string, input: { billTransport: boolean; invoiceNote: string }): Promise<ActionResult> {
  await assertOwner();
  const p = z.object({ companyId: z.uuid(), billTransport: z.boolean(), invoiceNote: z.string().trim().max(1000) }).safeParse({ companyId, ...input });
  if (!p.success) return fail("入力内容を確認してください");
  const supabase = await createClient();
  const { error } = await supabase
    .from("company_billing")
    .upsert({ company_id: p.data.companyId, bill_transport: p.data.billTransport, invoice_note: p.data.invoiceNote });
  if (error) return fail(dbErrorMessage(error));
  refresh(companyId);
  return ok("請求設定を保存しました");
}

/** 取引先の標準単価（venueId を渡すと「取引先×会場」の標準）。空にした単価は消す */
export async function saveClientRates(companyId: string, venueId: string | null, rows: RateInput[]): Promise<ActionResult> {
  await assertOwner();
  const p = z.object({ companyId: z.uuid(), venueId: z.uuid().nullable(), rows: z.array(rateRow).max(200) }).safeParse({ companyId, venueId, rows });
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await createClient();
  let del = supabase.from("client_rates").delete().eq("company_id", companyId);
  del = venueId ? del.eq("venue_id", venueId) : del.is("venue_id", null);
  const { error: delError } = await del;
  if (delError) return fail(dbErrorMessage(delError));
  const insert = rowsFor(p.data.rows).map((r) => ({ ...r, company_id: companyId, venue_id: venueId }));
  if (insert.length) {
    const { error } = await supabase.from("client_rates").insert(insert);
    if (error) return fail(dbErrorMessage(error));
  }
  refresh(companyId);
  return ok(venueId ? "この会場の単価を保存しました" : "標準単価を保存しました");
}

/** 現場ごとの単価の上書き・インセンティブの上書き・日当の上書き（締めた月は DB が止める） */
export async function saveEventMoney(
  eventId: string,
  input: { rates: RateInput[]; incentives: { itemId: string; amount: number | null }[]; daily: { assignmentId: string; amount: number | null }[] },
): Promise<ActionResult> {
  await assertOwner();
  const p = z
    .object({
      eventId: z.uuid(),
      rates: z.array(rateRow).max(200),
      incentives: z.array(z.object({ itemId: z.uuid(), amount: yen.nullable() })).max(100),
      daily: z.array(z.object({ assignmentId: z.uuid(), amount: yen.nullable() })).max(200),
    })
    .safeParse({ eventId, ...input });
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await createClient();

  const steps: PromiseLike<{ error: { code?: string; message?: string } | null }>[] = [];
  // 単価の上書き: 入れ直す
  const { error: e1 } = await supabase.from("event_rates").delete().eq("event_id", eventId);
  if (e1) return fail(dbErrorMessage(e1));
  const rates = rowsFor(p.data.rates).map((r) => ({ ...r, event_id: eventId }));
  if (rates.length) steps.push(supabase.from("event_rates").insert(rates));
  // インセンティブの上書き
  const { error: e2 } = await supabase.from("event_incentive_rates").delete().eq("event_id", eventId);
  if (e2) return fail(dbErrorMessage(e2));
  const inc = p.data.incentives.filter((i) => i.amount != null).map((i) => ({ event_id: eventId, item_id: i.itemId, amount: i.amount! }));
  if (inc.length) steps.push(supabase.from("event_incentive_rates").insert(inc));
  // 日当の上書き（アサインごと）
  const set = p.data.daily.filter((d) => d.amount != null).map((d) => ({ assignment_id: d.assignmentId, daily_rate_override: d.amount! }));
  const clear = p.data.daily.filter((d) => d.amount == null).map((d) => d.assignmentId);
  if (set.length) steps.push(supabase.from("assignment_private").upsert(set));
  if (clear.length) steps.push(supabase.from("assignment_private").delete().in("assignment_id", clear));
  for (const r of await Promise.all(steps)) if (r.error) return fail(dbErrorMessage(r.error));

  refresh(undefined, eventId);
  return ok("この現場の単価を保存しました");
}

/** インセンティブ単価（全体の標準）。空にした項目は消す */
export async function saveIncentiveRates(rows: { itemId: string; amount: number | null }[]): Promise<ActionResult> {
  await assertOwner();
  const p = z.array(z.object({ itemId: z.uuid(), amount: yen.nullable() })).max(100).safeParse(rows);
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await createClient();
  const set = p.data.filter((r) => r.amount != null).map((r) => ({ item_id: r.itemId, amount: r.amount! }));
  const clear = p.data.filter((r) => r.amount == null).map((r) => r.itemId);
  if (set.length) {
    const { error } = await supabase.from("incentive_rates").upsert(set);
    if (error) return fail(dbErrorMessage(error));
  }
  if (clear.length) {
    const { error } = await supabase.from("incentive_rates").delete().in("item_id", clear);
    if (error) return fail(dbErrorMessage(error));
  }
  revalidatePath("/settings/money");
  revalidatePath("/money", "layout");
  return ok("インセンティブ単価を保存しました");
}

/** 税・源泉・支払日の設定 */
export async function saveMoneySettings(input: {
  taxRatePercent: number;
  taxRounding: "floor" | "round" | "ceil";
  withholdingIncludeExpenses: boolean;
  withholdingTaxInclusive: boolean;
  paymentDay: number;
}): Promise<ActionResult> {
  await assertOwner();
  const p = z
    .object({
      taxRatePercent: z.number().int().min(0).max(30),
      taxRounding: z.enum(["floor", "round", "ceil"]),
      withholdingIncludeExpenses: z.boolean(),
      withholdingTaxInclusive: z.boolean(),
      paymentDay: z.number().int().min(0, "支払日を確認してください").max(31, "支払日を確認してください"),
    })
    .safeParse(input);
  if (!p.success) return fail(p.error.issues[0].message);
  const v = p.data;
  const supabase = await createClient();
  const { error } = await supabase.from("owner_settings").upsert([
    { key: "consumption_tax", value: { rate_percent: v.taxRatePercent, rounding: v.taxRounding } },
    { key: "withholding", value: { include_expenses: v.withholdingIncludeExpenses, tax_inclusive: v.withholdingTaxInclusive } },
    { key: "payment_day", value: v.paymentDay },
  ]);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/settings/money");
  revalidatePath("/money", "layout");
  return ok("税・源泉・支払日の設定を保存しました");
}

/** 月次目標（売上・粗利）。両方空の月は消す */
export async function saveTargets(rows: { month: string; revenue: number | null; grossProfit: number | null }[]): Promise<ActionResult> {
  await assertOwner();
  const p = z
    .array(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), revenue: yen.nullable(), grossProfit: z.number().int().nullable() }))
    .max(36)
    .safeParse(rows);
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await createClient();
  const set = p.data.filter((r) => r.revenue != null || r.grossProfit != null).map((r) => ({ month: `${r.month}-01`, revenue: r.revenue, gross_profit: r.grossProfit }));
  const clear = p.data.filter((r) => r.revenue == null && r.grossProfit == null).map((r) => `${r.month}-01`);
  if (set.length) {
    const { error } = await supabase.from("monthly_targets").upsert(set);
    if (error) return fail(dbErrorMessage(error));
  }
  if (clear.length) {
    const { error } = await supabase.from("monthly_targets").delete().in("month", clear);
    if (error) return fail(dbErrorMessage(error));
  }
  revalidatePath("/settings/targets");
  revalidatePath("/money", "layout");
  revalidatePath("/");
  return ok("月次目標を保存しました");
}
