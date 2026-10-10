"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertMember } from "@/lib/auth";
import { formatShortJa, isDateString, todayJst } from "@/lib/date";
import { sortCompanies } from "@/lib/sales";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

const STATUSES = ["not_contacted", "contacted", "meeting_set", "met", "active", "dormant"] as const;

const activitySchema = z.object({
  company_id: z.uuid(),
  kind: z.enum(["call", "line", "email", "visit", "meeting", "other"]),
  result: z.enum(["reached", "absent", "callback", "sent_material", "appointment", "declined"]).nullable(),
  memo: z.string().trim().max(2000, "メモは2000文字までです"),
  contact_id: z.uuid().nullable(),
  next_action_date: z
    .string()
    .nullable()
    .refine((v) => v == null || isDateString(v), "次回アクション日を確認してください"),
  next_action: z.string().trim().max(200, "「次にやること」は200文字までです"),
  status: z.enum(STATUSES),
});

export type ActivityInput = z.input<typeof activitySchema>;
export type ActivityBefore = { status: (typeof STATUSES)[number]; next_action_date: string | null; next_action: string };

/** 活動を記録し、会社の次回アクション（とステータス）を書き換える（要件 §4.8） */
export async function recordActivity(input: ActivityInput): Promise<ActionResult<{ id: string; before: ActivityBefore }>> {
  await assertMember();
  const parsed = activitySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const v = parsed.data;
  if (v.next_action_date && v.next_action_date < todayJst()) return fail("次回アクション日は今日以降を選んでください");
  // 日付だけ選んで「次にやること」が空のときは、何をするか分かる言葉を入れておく
  const nextAction = v.next_action_date ? v.next_action || "連絡する" : "";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_activity", {
    p_company_id: v.company_id,
    p_kind: v.kind,
    // 型の生成では引数が空にできない形になるが、DB の関数は空（null）を受け付ける
    p_result: v.result as never,
    p_memo: v.memo,
    p_contact_id: v.contact_id as never,
    p_next_action_date: v.next_action_date as never,
    p_next_action: nextAction,
    p_status: v.status,
  });
  if (error || !data) return fail(dbErrorMessage(error, "記録できませんでした。もう一度お試しください。"));
  const r = data as { id: string; before: ActivityBefore };
  revalidatePath("/sales", "layout");
  revalidatePath("/");
  return ok(v.next_action_date ? `記録しました（次回 ${formatShortJa(v.next_action_date)} ${nextAction}）` : "記録しました", r);
}

/** 記録の取り消し（「元に戻す」。記録した本人が15分以内に限る） */
export async function undoActivity(id: string, before: ActivityBefore): Promise<ActionResult> {
  await assertMember();
  if (!z.uuid().safeParse(id).success) return fail("不正な記録です");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("undo_activity", { p_activity_id: id, p_before: before as unknown as Json });
  if (error) return fail(dbErrorMessage(error));
  if (!data) return fail("時間がたったため元に戻せませんでした");
  revalidatePath("/sales", "layout");
  revalidatePath("/");
  return ok("記録を取り消しました");
}

export type RecordTarget = {
  id: string;
  name: string;
  kana: string;
  kind: "client" | "partner";
  status: (typeof STATUSES)[number];
  next_action_date: string | null;
  next_action: string;
  contacts: { id: string; name: string }[];
};

/** ＋ボタンの「活動を記録」で選ぶ会社（今日やることが上） */
export async function listRecordTargets(): Promise<RecordTarget[]> {
  await assertMember();
  const supabase = await createClient();
  const { data } = await supabase
    .from("companies")
    .select("id, name, kana, kind, status, priority, next_action_date, next_action, contacts(id, name, is_active)")
    .eq("is_active", true);
  return sortCompanies(data ?? [], todayJst()).map((c) => ({
    id: c.id,
    name: c.name,
    kana: c.kana,
    kind: c.kind,
    status: c.status,
    next_action_date: c.next_action_date,
    next_action: c.next_action,
    contacts: c.contacts.filter((ct) => ct.is_active).map((ct) => ({ id: ct.id, name: ct.name })),
  }));
}
