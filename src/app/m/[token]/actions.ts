"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { callMypage } from "@/lib/mypage";

export type MypageResult = { ok: true; message: string; status?: string } | { ok: false; message: string };

const token = z.string().min(40).max(100);

export async function respondOffer(t: string, assignmentId: string, accept: boolean): Promise<MypageResult> {
  if (!token.safeParse(t).success || !z.uuid().safeParse(assignmentId).success) return { ok: false, message: "URLが正しくありません" };
  const r = await callMypage<{ status: string; already?: boolean }>("mypage_respond", { p_token: t, p_assignment_id: assignmentId, p_accept: accept });
  if (!r.ok) return { ok: false, message: r.error };
  revalidatePath(`/m/${t}`, "layout");
  const s = r.data.status;
  if (r.data.already) return { ok: true, status: s, message: "すでに回答済みです。変更したいときは管理者に連絡してください。" };
  return {
    ok: true,
    status: s,
    message:
      s === "confirmed"
        ? "確定しました！「予定」で集合時刻などを確認してください。"
        : s === "waitlisted"
          ? "定員に達していたため「補欠」になりました。空きが出たら連絡します。"
          : "「参加できない」で回答しました。",
  };
}

const reportSchema = z.object({
  items: z.array(z.object({ item_id: z.uuid(), count: z.number().int().min(0).max(999) })),
  comment: z.string().max(500),
  transportAmount: z.number().int().min(0).max(1_000_000),
  transportMemo: z.string().max(200),
  otherAmount: z.number().int().min(0).max(1_000_000),
  otherMemo: z.string().max(200),
});

export async function saveReport(t: string, assignmentId: string, input: z.input<typeof reportSchema>): Promise<MypageResult> {
  const parsed = reportSchema.safeParse(input);
  if (!token.safeParse(t).success || !parsed.success) return { ok: false, message: "入力内容を確認してください" };
  const d = parsed.data;
  const r = await callMypage("mypage_report_save", {
    p_token: t,
    p_assignment_id: assignmentId,
    p_items: d.items,
    p_comment: d.comment,
    p_transport_amount: d.transportAmount,
    p_transport_memo: d.transportMemo,
    p_other_amount: d.otherAmount,
    p_other_memo: d.otherMemo,
  });
  if (!r.ok) return { ok: false, message: r.error };
  revalidatePath(`/m/${t}`, "layout");
  return { ok: true, message: "報告を送信しました。おつかれさまでした！" };
}

export async function saveAvailability(
  t: string,
  month: string,
  days: Record<string, "ok" | "maybe" | "ng" | null>,
  memo: string,
  submit: boolean,
): Promise<MypageResult> {
  if (!token.safeParse(t).success || !z.iso.date().safeParse(month).success) return { ok: false, message: "URLが正しくありません" };
  const r = await callMypage("mypage_availability_save", { p_token: t, p_month: month, p_days: days, p_memo: memo.slice(0, 300), p_submit: submit });
  if (!r.ok) return { ok: false, message: r.error };
  revalidatePath(`/m/${t}`, "layout");
  return { ok: true, message: submit ? "稼働可能日を提出しました。ありがとうございます！" : "保存しました" };
}
