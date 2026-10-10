"use server";

import { revalidatePath } from "next/cache";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertMember, assertOwner } from "@/lib/auth";
import { spreadsheetIdFrom } from "@/lib/google/sheets";
import { runSheetExport } from "@/lib/sheet-export";
import { createClient } from "@/lib/supabase/server";

/** 書き出し先のスプレッドシートを決める（空にすると書き出しを止める。オーナーのみ） */
export async function saveSheetExportTarget(input: string): Promise<ActionResult> {
  await assertOwner();
  const supabase = await createClient();
  if (!input.trim()) {
    const { error } = await supabase.from("settings").upsert({ key: "sheet_export", value: { spreadsheet_id: null } });
    if (error) return fail(dbErrorMessage(error));
    revalidatePath("/events/board");
    return ok("書き出しを止めました");
  }
  const id = spreadsheetIdFrom(input);
  if (!id) return fail("スプレッドシートの URL を貼り付けてください（https://docs.google.com/spreadsheets/d/… の形）");
  const { error } = await supabase.from("settings").upsert({ key: "sheet_export", value: { spreadsheet_id: id } });
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/events/board");
  return ok("書き出し先を保存しました");
}

/** 今すぐ書き出す（オーナー・管理者） */
export async function exportSheetNow(): Promise<ActionResult> {
  await assertMember();
  const r = await runSheetExport("button");
  revalidatePath("/events/board");
  return r.ok ? ok(r.message) : fail(r.message);
}
