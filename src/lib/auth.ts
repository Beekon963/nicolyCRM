import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type AppUser = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "manager";
};

/** ログイン中の利用者（オーナー・管理者）。ログインしていない・無効化されている場合は null */
export const getAppUser = cache(async (): Promise<AppUser | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) return null;
  const { data: user } = await supabase
    .from("app_users")
    .select("id, name, email, role, is_active")
    .eq("id", uid)
    .maybeSingle();
  if (!user || !user.is_active) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role };
});

/** 管理画面: ログインしていなければログイン画面へ。無効化された人はログアウトさせる */
export async function requireMember(): Promise<AppUser> {
  const user = await getAppUser();
  if (user) return user;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  redirect(data?.claims?.sub ? "/auth/signout?error=not_allowed" : "/login");
}

/** オーナーだけの画面。管理者には「見つかりません」を返す（存在も知らせない） */
export async function requireOwner(): Promise<AppUser> {
  const user = await requireMember();
  if (user.role !== "owner") notFound();
  return user;
}

/** Server Action の最初に呼ぶ。権限がなければ例外（画面の表示とは別に必ず確認する） */
export async function assertMember(): Promise<AppUser> {
  const user = await getAppUser();
  if (!user) throw new Error("ログインし直してください");
  return user;
}

export async function assertOwner(): Promise<AppUser> {
  const user = await assertMember();
  if (user.role !== "owner") throw new Error("この操作はオーナーだけができます");
  return user;
}
