"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertOwner } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAnonClient, createClient } from "@/lib/supabase/server";

const inviteSchema = z.object({
  name: z.string().trim().min(1, "名前を入力してください"),
  email: z.email("メールアドレスの形式が正しくありません").trim().toLowerCase(),
  role: z.enum(["owner", "manager"]),
});

/**
 * ユーザーを招待する。
 * 1. 認証のユーザーを作る（メール確認済み。Google でもメールのリンクでもログインできる）
 * 2. app_users に権限を登録する
 * 3. ログイン用のリンクをメールで送る
 */
export async function inviteUser(input: z.input<typeof inviteSchema>): Promise<ActionResult> {
  await assertOwner();
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { name, email, role } = parsed.data;

  const admin = createAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (createError || !created.user) {
    if (/already been registered|already exists/i.test(createError?.message ?? "")) {
      return fail("このメールアドレスはすでに登録されています。");
    }
    return fail("招待できませんでした。もう一度お試しください。");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("app_users").insert({ id: created.user.id, name, email, role });
  if (error) {
    await admin.auth.admin.deleteUser(created.user.id);
    return fail(dbErrorMessage(error));
  }

  const { error: mailError } = await createAnonClient().auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  revalidatePath("/settings/users");
  return ok(
    mailError
      ? `${name}さんを登録しました（メールは送れませんでした。Google アカウントでログインしてもらってください）`
      : `${name}さんを招待しました。ログイン用のメールを送りました。`,
  );
}

/** 無効化（即ログイン不可）・再有効化 */
export async function setUserActive(userId: string, active: boolean): Promise<ActionResult> {
  const me = await assertOwner();
  if (userId === me.id) return fail("自分自身は無効化できません。");

  const supabase = await createClient();
  const { error } = await supabase.from("app_users").update({ is_active: active }).eq("id", userId);
  if (error) return fail(dbErrorMessage(error));

  // ログインそのものも止める（RLS は is_active で即時に止まっている）
  const admin = createAdminClient();
  await admin.auth.admin.updateUserById(userId, { ban_duration: active ? "none" : "876000h" });

  revalidatePath("/settings/users");
  return ok(active ? "有効にしました" : "無効にしました。この人はもうログインできません。");
}

export async function setUserRole(userId: string, role: "owner" | "manager"): Promise<ActionResult> {
  const me = await assertOwner();
  if (userId === me.id) return fail("自分自身の権限は変更できません。");
  const supabase = await createClient();
  const { error } = await supabase.from("app_users").update({ role }).eq("id", userId);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/settings/users");
  return ok(role === "owner" ? "オーナーに変更しました" : "管理者に変更しました");
}
