"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, fail, ok } from "@/lib/action-result";
import { assertOwner } from "@/lib/auth";
import { monthRange, todayJst } from "@/lib/date";
import type { ParsedMonthSheet } from "@/lib/import/month-sheet";
import { applyMonthSheetPlan, type MonthSheetReport } from "@/lib/import/month-sheet-apply";
import { buildPlan, type PlanChoices, type PlanContext } from "@/lib/import/month-sheet-plan";
import { selectAll } from "@/lib/supabase/select-all";
import { createClient } from "@/lib/supabase/server";
import { getAccessToken, readServiceAccount, SheetError, SheetsClient, spreadsheetIdFrom } from "@/lib/google/sheets";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "対象の月を選んでください");

const parsedSchema = z.object({
  month: z.number().int().nullable(),
  days: z.array(z.number().int()),
  warnings: z.array(z.string()),
  clients: z
    .array(
      z.object({
        name: z.string().min(1),
        lines: z.array(z.object({ day: z.number().int(), venue: z.string().min(1), required: z.number().int().min(0).max(100), rate: z.number().int().nullable(), transport: z.boolean() })),
      }),
    )
    .max(200),
  staff: z
    .array(
      z.object({
        rank: z.string(),
        name: z.string().min(1),
        station: z.string(),
        places: z.array(z.object({ day: z.number().int(), place: z.string().min(1) })),
        shifts: z.array(z.object({ day: z.number().int(), status: z.enum(["ok", "maybe", "ng"]) })),
        rates: z.array(z.object({ day: z.number().int(), amount: z.number().int().nullable(), raw: z.string() })),
      }),
    )
    .max(500),
});

const choicesSchema = z.object({
  month: monthSchema,
  clients: z.record(z.string(), z.string()),
  venues: z.record(z.string(), z.string()),
  staff: z.record(z.string(), z.string()),
  places: z.record(z.string(), z.string()),
});

async function loadPlanContext(month: string): Promise<PlanContext> {
  const supabase = await createClient();
  const { start, end } = monthRange(month);
  const [clients, venues, staff, events] = await Promise.all([
    selectAll((f, t) => supabase.from("companies").select("id, name").eq("kind", "client").order("id").range(f, t)),
    selectAll((f, t) => supabase.from("venues").select("id, name").order("id").range(f, t)),
    selectAll((f, t) => supabase.from("staff").select("id, name").order("id").range(f, t)),
    selectAll((f, t) => supabase.from("events").select("id, date, client_id, venue_id").gte("date", start).lte("date", end).is("cancelled_at", null).order("id").range(f, t)),
  ]);
  return { today: todayJst(), clients, venues, staff, events };
}

/** 突き合わせに使う取引先・会場・名簿・その月の現場（取り込み画面のプレビュー用） */
export async function getMonthSheetContext(month: string): Promise<ActionResult<PlanContext>> {
  await assertOwner();
  const m = monthSchema.safeParse(month);
  if (!m.success) return fail(m.error.issues[0].message);
  return { ok: true, data: await loadPlanContext(m.data) };
}

export type { MonthSheetReport } from "@/lib/import/month-sheet-apply";

export async function importMonthSheet(parsedInput: ParsedMonthSheet, choicesInput: PlanChoices, roleId: string): Promise<ActionResult<MonthSheetReport>> {
  await assertOwner();
  const parsed = parsedSchema.safeParse(parsedInput);
  const choices = choicesSchema.safeParse(choicesInput);
  if (!parsed.success || !choices.success) return fail("取り込めない形式です。ファイルを選び直してください");
  if (!z.uuid().safeParse(roleId).success) return fail("役割を選んでください");

  const supabase = await createClient();
  const ctx = await loadPlanContext(choices.data.month);
  const plan = buildPlan(parsed.data, ctx, choices.data);
  const r = await applyMonthSheetPlan(supabase, plan, roleId);
  if (!r.ok) return r;
  revalidatePath("/", "layout");
  const d = r.data!;
  const report: MonthSheetReport = { clients: d.clients, venues: d.venues, eventsCreated: d.eventsCreated, eventsReused: d.eventsReused, assignments: d.assignments, availability: d.availability, rates: d.rates, dailyRates: d.dailyRates };
  return ok("取り込みました", report);
}

/**
 * Google スプレッドシートの月のタブを直接読む（CSV を落とさなくてよい）。tab がなければタブの一覧だけ返す。
 * シートへの書き出しと同じサービスアカウントで読む（シートを「リンクを知っている全員」か、サービスアカウントに共有しておく）。
 */
export async function readGoogleSheetTab(urlOrId: string, tab: string | null): Promise<ActionResult<{ tabs: string[]; rows?: string[][] }>> {
  await assertOwner();
  const id = spreadsheetIdFrom(urlOrId);
  if (!id) return fail("スプレッドシートの URL を貼り付けてください（https://docs.google.com/spreadsheets/d/… の形）");
  const sa = readServiceAccount();
  if (!sa) return fail("Google のサービスアカウントが未設定です（シートへの書き出しと同じ設定です。docs/setup.md の「シートへの自動書き出し」）");
  try {
    const client = new SheetsClient(await getAccessToken(sa), id, sa.client_email);
    const titles = await client.sheetTitles();
    const tabs = titles.filter((t) => /^\d{6}$/.test(t)).sort((a, b) => b.localeCompare(a));
    if (!tab) {
      if (!tabs.length) return fail("このスプレッドシートには「202611」のような月のタブがありません");
      return ok(undefined, { tabs });
    }
    if (!titles.includes(tab)) return fail(`「${tab}」タブが見つかりません`);
    return ok(undefined, { tabs, rows: await client.readValues(tab) });
  } catch (e) {
    if (e instanceof SheetError)
      return fail(e.message.includes("書き込めません") ? `スプレッドシートを開けません。共有に ${sa.client_email} を追加してください（読むだけなら「閲覧者」で足ります）` : e.message);
    return fail("スプレッドシートを読めませんでした。時間をおいてもう一度試してください");
  }
}
