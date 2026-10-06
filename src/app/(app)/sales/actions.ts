"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const companySchema = z.object({
  id: z.uuid().optional(),
  kind: z.enum(["client", "partner"]),
  name: z.string().trim().min(1, "会社名を入力してください"),
  kana: z.string().trim(),
  phone: z.string().trim(),
  address: z.string().trim(),
  website: z.string().trim(),
  status: z.enum(["not_contacted", "contacted", "meeting_set", "met", "active", "dormant"]),
  priority: z.enum(["high", "mid", "low"]),
  owner_user_id: z.string().transform((v) => v || null),
  next_action_date: z.string().transform((v) => v || null),
  next_action: z.string().trim(),
  memo: z.string().trim(),
  is_active: z.boolean(),
});

export type CompanyInput = z.input<typeof companySchema>;

export async function saveCompany(input: CompanyInput): Promise<ActionResult<{ id: string }>> {
  await assertMember();
  const parsed = companySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { id, ...values } = parsed.data;
  const supabase = await createClient();
  const { data, error } = id
    ? await supabase.from("companies").update(values).eq("id", id).select("id").single()
    : await supabase.from("companies").insert(values).select("id").single();
  if (error || !data) return fail(dbErrorMessage(error));
  revalidatePath("/sales", "layout");
  return ok(id ? "保存しました" : "登録しました", { id: data.id });
}

const contactSchema = z.object({
  id: z.uuid().optional(),
  company_id: z.uuid(),
  name: z.string().trim().min(1, "担当者の名前を入力してください"),
  title: z.string().trim(),
  phone: z.string().trim(),
  email: z.string().trim(),
  line: z.string().trim(),
  memo: z.string().trim(),
  is_active: z.boolean(),
});

export type ContactInput = z.input<typeof contactSchema>;

export async function saveContact(input: ContactInput): Promise<ActionResult> {
  await assertMember();
  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { id, ...values } = parsed.data;
  const supabase = await createClient();
  const { error } = id ? await supabase.from("contacts").update(values).eq("id", id) : await supabase.from("contacts").insert(values);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath(`/sales/${values.company_id}`);
  return ok("保存しました");
}

/** 取引先で使う獲得項目（Phase 0 決定3）。空にすると全項目 */
export async function saveCompanyItems(companyId: string, itemIds: string[]): Promise<ActionResult> {
  await assertMember();
  const ids = z.array(z.uuid()).safeParse(itemIds);
  if (!ids.success) return fail("不正な項目です");
  const supabase = await createClient();
  const { error: delError } = await supabase.from("company_items").delete().eq("company_id", companyId);
  if (delError) return fail(dbErrorMessage(delError));
  if (ids.data.length) {
    const { error } = await supabase.from("company_items").insert(ids.data.map((item_id) => ({ company_id: companyId, item_id })));
    if (error) return fail(dbErrorMessage(error));
  }
  revalidatePath(`/sales/${companyId}`);
  return ok(ids.data.length ? "使う獲得項目を保存しました" : "すべての獲得項目を使う設定にしました");
}

const linkSchema = z.object({
  company_id: z.uuid(),
  title: z.string().trim(),
  url: z.url("http:// または https:// で始まる URL を入力してください").regex(/^https?:\/\//i, "http:// または https:// で始まる URL を入力してください"),
});

export async function addCompanyLink(input: z.input<typeof linkSchema>): Promise<ActionResult> {
  await assertMember();
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const supabase = await createClient();
  const { error } = await supabase.from("company_links").insert(parsed.data);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath(`/sales/${parsed.data.company_id}`);
  return ok("リンクを追加しました");
}

export async function removeCompanyLink(companyId: string, linkId: string): Promise<ActionResult> {
  await assertMember();
  const supabase = await createClient();
  const { error } = await supabase.from("company_links").delete().eq("id", linkId);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath(`/sales/${companyId}`);
  return ok("リンクを外しました");
}
