"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertOwner } from "@/lib/auth";
import { computeMonthLive, getMoneySettings, toSnapshot } from "@/lib/data/money";
import { getReferralBonusTargets } from "@/lib/data/referrals";
import type { FreeeSettings } from "@/lib/export/freee";
import { toZenginKana } from "@/lib/export/kana";
import type { ZenginSender } from "@/lib/export/zengin";
import type { Json } from "@/lib/supabase/database.types";
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

/** ランク制度の決まり: 遠方の上乗せの1回分と、友達紹介のボーナス（Phase 12。オーナーのみ） */
export async function saveRankRules(input: { travelStepAmount: number | null; referralAmount: number | null; referralAfter: number }): Promise<ActionResult> {
  await assertOwner();
  const yen = z.number().int("金額は整数（円）で入れてください").min(0, "金額は0円以上にしてください").max(1_000_000, "金額が大きすぎます").nullable();
  const p = z
    .object({ travelStepAmount: yen, referralAmount: yen, referralAfter: z.number().int().min(1, "回数は1回以上にしてください").max(100, "回数が大きすぎます") })
    .safeParse(input);
  if (!p.success) return fail(p.error.issues[0].message);
  const v = p.data;
  const supabase = await createClient();
  const { error } = await supabase.from("owner_settings").upsert([
    { key: "travel_allowance", value: { per_step: v.travelStepAmount } },
    { key: "referral_bonus", value: { amount: v.referralAmount, after: v.referralAfter } },
  ]);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/settings/money");
  revalidatePath("/money", "layout");
  return ok("遠方の上乗せ・友達紹介の設定を保存しました");
}

/**
 * 友達紹介のボーナスを、紹介した人のその月の調整額に足す（Phase 12。オーナーのみ）。
 * 紹介された人が決めた回数稼働していて、まだ足していないときだけ。調整額を消せば、もう一度足せる
 */
export async function addReferralBonus(referredStaffId: string, month: string): Promise<ActionResult> {
  await assertOwner();
  if (!z.uuid().safeParse(referredStaffId).success || !/^\d{4}-\d{2}$/.test(month)) return fail("不正な指定です");
  const settings = await getMoneySettings();
  if (settings.referralBonus.amount == null) return fail("お金の設定で、友達紹介のボーナスの額を入れてください");
  const target = (await getReferralBonusTargets(settings.referralBonus.after)).find((t) => t.staffId === referredStaffId);
  if (!target) return fail("ボーナスの対象ではありません（まだ回数に届いていないか、もう足しています）");
  const supabase = await createClient();
  const { data: adj, error } = await supabase
    .from("payment_adjustments")
    .insert({
      staff_id: target.referrerId,
      month: `${month}-01`,
      amount: settings.referralBonus.amount,
      reason: `友達紹介のボーナス（${target.name}さんが${settings.referralBonus.after}回稼働）`,
    })
    .select("id")
    .single();
  if (error || !adj) return fail(dbErrorMessage(error));
  const { error: e2 } = await supabase.from("referral_bonuses").insert({ referred_staff_id: target.staffId, referrer_staff_id: target.referrerId, adjustment_id: adj.id });
  if (e2) {
    await supabase.from("payment_adjustments").delete().eq("id", adj.id);
    return fail(dbErrorMessage(e2));
  }
  revalidatePath("/money", "layout");
  return ok(`${target.referrerName}さんの調整額にボーナスを足しました`);
}

/** 調整額（＋/−、理由は必須）。締めた月は DB が止める */
export async function addAdjustment(staffId: string, month: string, amount: number, reason: string): Promise<ActionResult> {
  await assertOwner();
  const p = z
    .object({
      staffId: z.uuid(),
      month: z.string().regex(/^\d{4}-\d{2}$/),
      amount: z.number().int("金額は整数（円）で入れてください").refine((v) => v !== 0, "金額を入れてください").refine((v) => Math.abs(v) <= 10_000_000, "金額が大きすぎます"),
      reason: z.string().trim().min(1, "理由を入れてください").max(200),
    })
    .safeParse({ staffId, month, amount, reason });
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await createClient();
  const { error } = await supabase.from("payment_adjustments").insert({ staff_id: p.data.staffId, month: `${p.data.month}-01`, amount: p.data.amount, reason: p.data.reason });
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/money", "layout");
  return ok("調整額を追加しました");
}

export async function removeAdjustment(id: string): Promise<ActionResult> {
  await assertOwner();
  if (!z.uuid().safeParse(id).success) return fail("不正な指定です");
  const supabase = await createClient();
  const { error } = await supabase.from("payment_adjustments").delete().eq("id", id);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/money", "layout");
  return ok("調整額を消しました");
}

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/);
const monthLabel = (m: string) => `${Number(m.slice(0, 4))}年${Number(m.slice(5, 7))}月`;

function refreshMonth() {
  revalidatePath("/money", "layout");
  revalidatePath("/events", "layout");
  revalidatePath("/");
}

/**
 * 月次締め（初めて・もう一度）。いまのデータで計算した請求・支払い・月の数字を保存し、その月を変更できなくする。
 * 支払済みの人の金額が変わったときは人数を返す（差額は翌月の調整額で精算する）。
 */
export async function closeMonth(month: string): Promise<ActionResult<{ changedPaid: number }>> {
  await assertOwner();
  if (!monthSchema.safeParse(month).success) return fail("月の指定が正しくありません");
  const snap = toSnapshot(await computeMonthLive(month));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("close_month", {
    p_month: `${month}-01`,
    p_summary: snap.summary as unknown as Json,
    p_invoices: snap.invoices as unknown as Json,
    p_payments: snap.payments as unknown as Json,
  });
  if (error) return fail(dbErrorMessage(error, "締められませんでした。もう一度お試しください。"));
  const changedPaid = ((data as { changed_paid?: unknown[] } | null)?.changed_paid ?? []).length;
  refreshMonth();
  return ok(`${monthLabel(month)}を締めました`, { changedPaid });
}

/** ロック解除（理由は必須） */
export async function unlockMonth(month: string, reason: string): Promise<ActionResult> {
  await assertOwner();
  const p = z.object({ month: monthSchema, reason: z.string().trim().min(1, "ロックを解除する理由を入れてください").max(500) }).safeParse({ month, reason });
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await createClient();
  const { error } = await supabase.rpc("unlock_month", { p_month: `${month}-01`, p_reason: p.data.reason });
  if (error) return fail(dbErrorMessage(error));
  refreshMonth();
  return ok(`${monthLabel(month)}のロックを解除しました。直したら、もう一度締めてください`);
}

/** 支払済みにする（paidOn が null なら取り消す）。締めた月だけ */
export async function setPaid(month: string, staffIds: string[], paidOn: string | null): Promise<ActionResult> {
  await assertOwner();
  const p = z
    .object({ month: monthSchema, staffIds: z.array(z.uuid()).min(1).max(500), paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "支払日を入れてください").nullable() })
    .safeParse({ month, staffIds, paidOn });
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_payments_paid", { p_month: `${month}-01`, p_staff_ids: p.data.staffIds, p_paid_on: p.data.paidOn as string });
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/money", "layout");
  const n = data ?? 0;
  return ok(paidOn ? `${n}人を支払済みにしました` : `${n}人の支払済みを取り消しました`);
}

/** freee の書き出しの勘定科目・税区分 */
export async function saveFreeeSettings(input: FreeeSettings): Promise<ActionResult> {
  await assertOwner();
  const text = z.string().trim().max(50);
  const p = z
    .object({
      salesAccount: text.min(1, "売上の勘定科目を入れてください"),
      salesTax: text.min(1, "売上の税区分を入れてください"),
      rewardAccount: text.min(1, "報酬の勘定科目を入れてください"),
      expenseAccount: text.min(1, "交通費・経費の勘定科目を入れてください"),
      purchaseTaxRegistered: text.min(1, "インボイス登録ありの税区分を入れてください"),
      purchaseTaxUnregistered: text,
      withholdingAccount: text.min(1, "源泉の勘定科目を入れてください"),
      withholdingTax: text.min(1, "源泉の税区分を入れてください"),
    })
    .safeParse(input);
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await createClient();
  const { error } = await supabase.from("owner_settings").upsert({ key: "freee_export", value: p.data });
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/settings/money");
  revalidatePath("/money/export");
  return ok("freee の書き出しの設定を保存しました");
}

/** 振込データ（全銀）の振込元の口座・委託者コード */
export async function saveZenginSettings(input: Partial<ZenginSender>): Promise<ActionResult> {
  await assertOwner();
  const digits = (n: number, label: string) =>
    z
      .string()
      .trim()
      .transform((v) => v.normalize("NFKC"))
      .refine((v) => v === "" || new RegExp(`^\\d{${n}}$`).test(v), `${label}は${n}桁の数字です`);
  const kanaText = (label: string) =>
    z
      .string()
      .trim()
      .max(40)
      .refine((v) => v === "" || toZenginKana(v).ok, `${label}はカナで入れてください`);
  const p = z
    .object({
      requesterCode: digits(10, "委託者コード"),
      requesterName: kanaText("委託者名"),
      bankCode: digits(4, "銀行番号"),
      bankName: kanaText("銀行名"),
      branchCode: digits(3, "支店番号"),
      branchName: kanaText("支店名"),
      accountType: z.enum(["ordinary", "checking"]).optional(),
      accountNumber: z
        .string()
        .trim()
        .refine((v) => v === "" || /^\d{1,7}$/.test(v), "口座番号は7桁までの数字です"),
    })
    // 一度も触っていない欄は空として扱う
    .safeParse({ requesterCode: "", requesterName: "", bankCode: "", bankName: "", branchCode: "", branchName: "", accountNumber: "", ...input });
  if (!p.success) return fail(p.error.issues[0].message);
  const supabase = await createClient();
  const { error } = await supabase.from("owner_settings").upsert({ key: "zengin", value: p.data });
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/settings/money");
  revalidatePath("/money/export");
  return ok("振込データの設定を保存しました");
}
