"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertOwner } from "@/lib/auth";
import { spreadsheetIdFrom } from "@/lib/google/sheets";
import type { AliasKind } from "@/lib/import/sheet-sync-plan";
import { runSheetSync } from "@/lib/sheet-sync";
import { runSheetWriteback } from "@/lib/sheet-writeback";
import { createClient } from "@/lib/supabase/server";

/** シートを自動で読む設定（オーナーのみ。金額なし） */
export async function saveSheetSyncSettings(input: { enabled: boolean; url: string; roleId: string; writeback?: boolean }): Promise<ActionResult> {
  await assertOwner();
  const supabase = await createClient();
  let spreadsheetId: string | null = null;
  if (input.url.trim()) {
    spreadsheetId = spreadsheetIdFrom(input.url);
    if (!spreadsheetId) return fail("スプレッドシートの URL を貼り付けてください（https://docs.google.com/spreadsheets/d/… の形）");
  }
  const roleId = z.uuid().safeParse(input.roleId).success ? input.roleId : null;
  const writeback = input.writeback === true;
  const { error } = await supabase.from("settings").upsert({ key: "sheet_sync", value: { enabled: input.enabled, spreadsheet_id: spreadsheetId, role_id: roleId, writeback } });
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/import");
  revalidatePath("/events/board");
  revalidatePath("/");
  return ok(`${input.enabled ? "自動で読むようにしました（10分ごと）" : "自動で読むのを止めました"}。シートへの書き戻しは${writeback ? "オン（2分ごと）" : "オフ"}です`);
}

/** 今すぐシートに書く（書き戻し。オーナーのみ） */
export async function writebackNow(): Promise<ActionResult> {
  await assertOwner();
  const r = await runSheetWriteback("button");
  revalidatePath("/import");
  return r.ok ? ok(r.message) : fail(r.message);
}

/** 今すぐ読む（オーナーのみ。金額の列も入るため） */
export async function syncSheetNow(): Promise<ActionResult> {
  await assertOwner();
  const r = await runSheetSync("button");
  revalidatePath("/", "layout");
  return r.ok ? ok(r.message) : fail(r.message);
}

const aliasSchema = z.object({
  kind: z.enum(["client", "venue", "staff", "place"]),
  sheetName: z.string().trim().min(1).max(200),
  /** 既存の id / "new"（会場・取引先を新しく作る） / "skip"（取り込まない） */
  target: z.string().min(1),
});

/** 合わない名前の対応づけ（オーナーのみ）。決めたことは覚えて、次の読み取りから自動で入る */
export async function saveSheetAlias(input: { kind: AliasKind; sheetName: string; target: string }): Promise<ActionResult> {
  await assertOwner();
  const p = aliasSchema.safeParse(input);
  if (!p.success) return fail("対応づけの内容が正しくありません");
  const { kind, sheetName, target } = p.data;
  const supabase = await createClient();

  let targetId: string | null = null;
  if (target === "skip") targetId = null;
  else if (target === "new") {
    if (kind === "venue") {
      const { data, error } = await supabase.from("venues").insert({ name: sheetName }).select("id").single();
      if (error) return fail(dbErrorMessage(error));
      targetId = data.id;
    } else if (kind === "client") {
      const { data, error } = await supabase.from("companies").insert({ kind: "client", name: sheetName, status: "active" }).select("id").single();
      if (error) return fail(dbErrorMessage(error));
      targetId = data.id;
    } else return fail("スタッフは名簿の取り込みで先に入れてください");
  } else {
    if (!z.uuid().safeParse(target).success) return fail("選び直してください");
    const table = kind === "staff" ? "staff" : kind === "venue" ? "venues" : "companies";
    const { data } = await supabase.from(table).select("id").eq("id", target).maybeSingle();
    if (!data) return fail("選んだものが見つかりません");
    targetId = target;
  }
  const { error } = await supabase.from("sheet_name_aliases").upsert({ kind, sheet_name: sheetName, target_id: targetId }, { onConflict: "kind,sheet_name" });
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/import");
  revalidatePath("/");
  return ok(targetId ? "対応づけました。次に読むときから入ります" : "取り込まないようにしました");
}

/** 覚えた対応づけを消す（オーナーのみ） */
export async function deleteSheetAlias(id: string): Promise<ActionResult> {
  await assertOwner();
  if (!z.uuid().safeParse(id).success) return fail("選び直してください");
  const supabase = await createClient();
  const { error } = await supabase.from("sheet_name_aliases").delete().eq("id", id);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/import");
  return ok("対応づけを消しました");
}
