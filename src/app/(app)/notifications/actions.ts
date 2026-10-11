"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { LineLinkStart } from "@/components/app/line-link";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertMember, assertOwner } from "@/lib/auth";
import { addFriendUrl, LineClient, lineConfig, sendTextUrl, text } from "@/lib/line/client";
import { lineBot } from "@/lib/line/notify";
import { createClient } from "@/lib/supabase/server";

const PATH = "/notifications";

const settingsSchema = z.object({ staffConfirm: z.boolean(), reminder: z.boolean(), reminderHour: z.number().int().min(0).max(23), adminNotify: z.boolean() });

/** LINE のお知らせの設定（オーナーのみ） */
export async function saveLineSettings(input: z.infer<typeof settingsSchema>): Promise<ActionResult> {
  await assertOwner();
  const p = settingsSchema.safeParse(input);
  if (!p.success) return fail("入力内容を確認してください");
  const supabase = await createClient();
  const { error } = await supabase.from("settings").upsert({ key: "line", value: p.data });
  if (error) return fail(dbErrorMessage(error));
  revalidatePath(PATH);
  return ok("保存しました");
}

/** 自分の LINE とつなぐコードを出す */
export async function startMyLineLink(): Promise<LineLinkStart> {
  await assertMember();
  const bot = await lineBot();
  if (!bot) return { ok: false, message: "LINE 公式アカウントの準備ができていません" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("line_link_code_for_me");
  if (error || !data) return { ok: false, message: "コードを出せませんでした。もう一度お試しください" };
  return { ok: true, code: data, addFriendUrl: addFriendUrl(bot.basicId), sendCodeUrl: sendTextUrl(bot.basicId, `連携コード ${data}`) };
}

/** 自分の LINE とのつながりを外す */
export async function unlinkMyLine(): Promise<ActionResult> {
  await assertMember();
  const supabase = await createClient();
  const { error } = await supabase.rpc("line_unlink_me");
  if (error) return fail(dbErrorMessage(error));
  revalidatePath(PATH);
  return ok();
}

/** 自分にテストのお知らせを送る（設定ができているか確かめる） */
export async function sendMyLineTest(): Promise<ActionResult> {
  const me = await assertMember();
  const cfg = lineConfig();
  if (!cfg) return fail("LINE 公式アカウントの準備ができていません");
  const supabase = await createClient();
  const { data } = await supabase.from("app_users").select("line_user_id").eq("id", me.id).maybeSingle();
  if (!data?.line_user_id) return fail("先に LINE とつないでください");
  try {
    await new LineClient(cfg).push(data.line_user_id, [text(`${me.name}さん、テストのお知らせです（NICOLY CRM）。これが届いていれば設定はできています。`)]);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "送れませんでした");
  }
  return ok("テストを送りました。LINE を見てください");
}
