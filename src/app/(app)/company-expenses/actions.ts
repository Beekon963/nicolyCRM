"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { type ReceiptReading, readReceipt } from "@/lib/ai/receipt";
import { assertOwner } from "@/lib/auth";
import { EXPENSE_LIMITS, EXPENSE_MAX_AMOUNT, expenseKey } from "@/lib/company-expenses";
import { getExpenseChoices } from "@/lib/data/company-expenses";
import { isDateString, monthOf } from "@/lib/date";
import { getAccessToken, readServiceAccount, SheetError, SheetsClient, spreadsheetIdFrom } from "@/lib/google/sheets";
import { planExpenseImport } from "@/lib/import/expense-sheet";
import { formatYen } from "@/lib/money/format";
import { createClient } from "@/lib/supabase/server";

/**
 * ★ 会社の経費（Phase 16）。オーナーだけ（最初に assertOwner。DB も RLS でオーナーだけ）。
 * 金額の変更は DB のトリガーで変更履歴に残る。消さずに取り消す（voided_at）
 */

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (max: number) => z.string().trim().max(max);

const Fields = z
  .object({
    paidBy: z.string().regex(ID).nullable(),
    spentOn: z.string().refine(isDateString, "日付を選んでください"),
    vendor: text(EXPENSE_LIMITS.vendor),
    item: text(EXPENSE_LIMITS.item),
    purpose: text(EXPENSE_LIMITS.purpose),
    category: text(EXPENSE_LIMITS.category),
    amount: z.number().int().min(1, "金額を入れてください").max(EXPENSE_MAX_AMOUNT, "金額が大きすぎます"),
    attendees: text(EXPENSE_LIMITS.attendees),
    memo: text(EXPENSE_LIMITS.memo),
  })
  .refine((v) => v.vendor || v.item, "店・支払先か、買ったものを入れてください");
export type ExpenseFields = z.input<typeof Fields>;

const RECEIPT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

function receiptFile(v: FormDataEntryValue | null): File | null | "bad" {
  if (!(v instanceof File) || v.size === 0) return null;
  if (!(RECEIPT_TYPES as readonly string[]).includes(v.type) || v.size > RECEIPT_MAX_BYTES) return "bad";
  return v;
}

const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "入力を確かめてください";

/** 入れる・直す（id があれば直す）。FormData: data = 入力の JSON、id、receipt = 領収書の写真（あれば） */
export async function saveCompanyExpense(form: FormData): Promise<ActionResult<{ id: string }>> {
  await assertOwner();
  const id = String(form.get("id") ?? "");
  if (id && !ID.test(id)) return fail("経費が見つかりません");
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("data") ?? ""));
  } catch {
    return fail("入力を確かめてください");
  }
  const parsed = Fields.safeParse(raw);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const file = receiptFile(form.get("receipt"));
  if (file === "bad") return fail("領収書の写真は 5MB までの写真（JPEG・PNG・WebP）にしてください");

  const v = parsed.data;
  const supabase = await createClient();
  let receiptPath: string | undefined;
  if (file) {
    receiptPath = `${monthOf(v.spentOn)}/${crypto.randomUUID()}.${file.type.split("/")[1].replace("jpeg", "jpg")}`;
    const { error } = await supabase.storage.from("receipts").upload(receiptPath, file, { contentType: file.type });
    if (error) return fail("領収書の写真を保存できませんでした。もう一度お試しください");
  }
  const row = {
    paid_by: v.paidBy,
    spent_on: v.spentOn,
    vendor: v.vendor,
    item: v.item,
    purpose: v.purpose,
    category: v.category,
    amount: v.amount,
    attendees: v.attendees,
    memo: v.memo,
    ...(receiptPath ? { receipt_path: receiptPath } : {}),
  };
  const res = id
    ? await supabase.from("company_expenses").update(row).eq("id", id).select("id").maybeSingle()
    : await supabase.from("company_expenses").insert(row).select("id").single();
  if (res.error || !res.data) {
    // 経費が入らなかったときは、入れたばかりの写真を片付ける
    if (receiptPath) await supabase.storage.from("receipts").remove([receiptPath]);
    return fail(res.error ? dbErrorMessage(res.error) : "経費が見つかりません");
  }
  revalidatePath("/company-expenses", "layout");
  return ok(id ? `直しました（${formatYen(v.amount)}）` : `経費を入れました（${formatYen(v.amount)}）`, { id: res.data.id });
}

/** 取り消す（voided = true）・元に戻す（false）。消さずに残し、合計に入れない */
export async function setCompanyExpenseVoided(id: string, voided: boolean): Promise<ActionResult> {
  await assertOwner();
  if (!ID.test(id)) return fail("経費が見つかりません");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_expenses")
    .update({ voided_at: voided ? new Date().toISOString() : null })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error || !data) return fail(error ? dbErrorMessage(error) : "経費が見つかりません");
  revalidatePath("/company-expenses", "layout");
  return ok(voided ? "取り消しました（合計に入りません）" : "元に戻しました");
}

/** 領収書の写真を AI に読ませて、入力欄に入れる値を返す（登録はしない） */
export async function readReceiptAction(form: FormData): Promise<ActionResult<ReceiptReading>> {
  await assertOwner();
  const file = receiptFile(form.get("receipt"));
  if (!file || file === "bad") return fail("写真を選び直してください（5MB までの写真）");
  const { categories } = await getExpenseChoices();
  const r = await readReceipt({ data: Buffer.from(await file.arrayBuffer()).toString("base64"), mediaType: file.type as (typeof RECEIPT_TYPES)[number] }, categories);
  if (!r.ok) return fail(r.message);
  return ok("AI が読み取りました。合っているか確かめてください", r.reading);
}

const ImportRow = z.object({
  spentOn: z.string().refine(isDateString),
  vendor: text(EXPENSE_LIMITS.vendor),
  item: text(EXPENSE_LIMITS.item),
  purpose: text(EXPENSE_LIMITS.purpose),
  category: text(EXPENSE_LIMITS.category),
  amount: z.number().int().min(1).max(EXPENSE_MAX_AMOUNT),
  attendees: text(EXPENSE_LIMITS.attendees),
  memo: text(EXPENSE_LIMITS.memo),
  receiptUrl: text(EXPENSE_LIMITS.receiptUrl),
});
const ImportSheets = z
  .array(z.object({ paidBy: z.string().regex(ID).nullable(), rows: z.array(ImportRow).max(5000) }))
  .max(20)
  .refine((sheets) => sheets.every((s) => s.rows.every((r) => r.vendor || r.item)), "買ったもの・支払先がない行があります");

/**
 * 今のスプレッドシートの経費をまとめて入れる。CRM にもう同じ経費（払った人・日付・金額・店・買ったもの）があれば入れない
 * （同じシートを2回取り込んでも増えない。取り消した経費も「ある」とみなし、取り消したものを生き返らせない）
 */
export async function importCompanyExpenses(sheets: unknown): Promise<ActionResult<{ inserted: number; skipped: number }>> {
  await assertOwner();
  const parsed = ImportSheets.safeParse(sheets);
  if (!parsed.success) return fail("取り込む内容が読めませんでした。ファイルを選び直してください");
  const rows = parsed.data.flatMap((s) => s.rows.map((r) => ({ ...r, paidBy: s.paidBy })));
  if (!rows.length) return fail("取り込む経費がありません");

  const supabase = await createClient();
  const dates = rows.map((r) => r.spentOn).sort();
  const { data: existing, error: readError } = await supabase
    .from("company_expenses")
    .select("paid_by, spent_on, amount, vendor, item")
    .gte("spent_on", dates[0])
    .lte("spent_on", dates.at(-1)!)
    .limit(10000);
  if (readError) return fail("今の経費を読めませんでした。もう一度お試しください");
  const plan = planExpenseImport(
    rows,
    (existing ?? []).map((e) => expenseKey({ paidBy: e.paid_by, spentOn: e.spent_on, amount: e.amount, vendor: e.vendor, item: e.item })),
  );
  for (let i = 0; i < plan.insert.length; i += 500) {
    const { error } = await supabase.from("company_expenses").insert(
      plan.insert.slice(i, i + 500).map((r) => ({
        paid_by: r.paidBy,
        spent_on: r.spentOn,
        vendor: r.vendor,
        item: r.item,
        purpose: r.purpose,
        category: r.category,
        amount: r.amount,
        attendees: r.attendees,
        memo: r.memo,
        receipt_url: r.receiptUrl,
      })),
    );
    if (error) return fail(i ? `${i}件を入れたところで止まりました。${dbErrorMessage(error)}` : dbErrorMessage(error));
  }
  revalidatePath("/company-expenses", "layout");
  const skippedNote = plan.skipped ? `（もう入っている ${plan.skipped}件は入れていません）` : "";
  const message = plan.insert.length ? `${plan.insert.length}件の経費を入れました${skippedNote}` : `もう全部入っていました（同じ経費 ${plan.skipped}件は入れていません）`;
  return ok(message, { inserted: plan.insert.length, skipped: plan.skipped });
}

/**
 * Google スプレッドシートの全部のシートを読む（CSV を保存しなくてよい）。シートへの書き出しと同じサービスアカウントで読むので、
 * シートをサービスアカウントに共有しておく。中身は画面で読み取る（CSV と同じ処理）
 */
export async function readExpenseSpreadsheet(urlOrId: string): Promise<ActionResult<{ tabs: { title: string; rows: string[][] }[] }>> {
  await assertOwner();
  const id = spreadsheetIdFrom(urlOrId);
  if (!id) return fail("スプレッドシートの URL を貼り付けてください（https://docs.google.com/spreadsheets/d/… の形）");
  const sa = readServiceAccount();
  if (!sa) return fail("Google のサービスアカウントが未設定なので、直接は読めません。シートを1枚ずつ「CSV」で保存して、下の「CSV ファイルを選ぶ」から入れてください");
  try {
    const client = new SheetsClient(await getAccessToken(sa), id, sa.client_email);
    const titles = await client.sheetTitles();
    const tabs = [];
    for (const title of titles.slice(0, 20)) tabs.push({ title, rows: await client.readValues(title) });
    return ok(undefined, { tabs });
  } catch (e) {
    if (e instanceof SheetError)
      return fail(e.message.includes("書き込めません") ? `スプレッドシートを開けません。共有に ${sa.client_email} を追加してください（読むだけなら「閲覧者」で足ります）` : e.message);
    return fail("スプレッドシートを読めませんでした。時間をおいてもう一度試してください");
  }
}
