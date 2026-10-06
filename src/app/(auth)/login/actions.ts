"use server";

import { z } from "zod";
import { createAnonClient } from "@/lib/supabase/server";

export type LinkState = { ok: boolean; message: string } | null;

const schema = z.object({ email: z.email("メールアドレスの形式が正しくありません") });

/** ログイン用リンクをメールで送る（登録済みのアドレスだけ） */
export async function sendLoginLink(_prev: LinkState, formData: FormData): Promise<LinkState> {
  const parsed = schema.safeParse({ email: String(formData.get("email") ?? "").trim() });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  const supabase = createAnonClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { shouldCreateUser: false },
  });
  if (error) {
    if (/signups? not allowed|not found|user not found/i.test(error.message)) {
      return { ok: false, message: "このメールアドレスは登録されていません。オーナーに招待を依頼してください。" };
    }
    if (/rate limit|security purposes/i.test(error.message)) {
      return { ok: false, message: "短い時間に何度も送信されました。少し時間をおいてからもう一度お試しください。" };
    }
    return { ok: false, message: "メールを送れませんでした。時間をおいてもう一度お試しください。" };
  }
  return { ok: true, message: `${parsed.data.email} にログイン用のリンクを送りました。メールを開いてリンクを押してください。` };
}
