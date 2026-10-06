"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertMember, assertOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const optionalId = z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable());

const staffSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "氏名を入力してください"),
  kana: z.string().trim(),
  phone: z.string().trim(),
  line_name: z.string().trim(),
  nearest_station: z.string().trim(),
  rank_id: optionalId,
  status: z.enum(["active", "paused", "ended"]),
  memo: z.string().trim(),
  role_ids: z.array(z.uuid()),
  area_ids: z.array(z.uuid()),
  base_daily_rate: z.number().int().min(0).nullable().optional(),
});

export type StaffInput = Omit<z.input<typeof staffSchema>, "rank_id"> & { rank_id?: string | null };

export async function saveStaff(input: StaffInput): Promise<ActionResult<{ id: string }>> {
  const me = await assertMember();
  const parsed = staffSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { id, role_ids, area_ids, base_daily_rate, ...values } = parsed.data;
  const supabase = await createClient();

  const { data, error } = id
    ? await supabase.from("staff").update(values).eq("id", id).select("id").single()
    : await supabase.from("staff").insert(values).select("id").single();
  if (error || !data) return fail(dbErrorMessage(error));
  const staffId = data.id;

  // 役割・エリアは付け直す
  for (const [table, col, ids] of [
    ["staff_roles", "role_id", role_ids],
    ["staff_areas", "area_id", area_ids],
  ] as const) {
    const { error: delError } = await supabase.from(table).delete().eq("staff_id", staffId);
    if (delError) return fail(dbErrorMessage(delError));
    if (ids.length) {
      const { error: insError } = await supabase.from(table).insert(ids.map((v) => ({ staff_id: staffId, [col]: v })) as never);
      if (insError) return fail(dbErrorMessage(insError));
    }
  }

  // 新規登録時の基本日当（オーナーのみ。ランクの基準日当が初期値）
  if (!id && me.role === "owner" && base_daily_rate != null) {
    await supabase.from("staff_private").upsert({ staff_id: staffId, base_daily_rate });
  }

  revalidatePath("/staff", "layout");
  return ok(id ? "保存しました" : "登録しました", { id: staffId });
}

/** マイページURLの再発行（古いURLはすぐ使えなくなる） */
export async function rotateMypageToken(staffId: string): Promise<ActionResult> {
  await assertMember();
  const supabase = await createClient();
  const token = randomBytes(32).toString("base64url");
  const { error } = await supabase
    .from("staff")
    .update({ mypage_token: token, token_rotated_at: new Date().toISOString() })
    .eq("id", staffId);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath(`/staff/${staffId}`);
  return ok("マイページURLを再発行しました。古いURLはもう使えません。新しいURLを本人に送ってください。");
}

const ngSchema = z.object({
  staffId: z.uuid(),
  target: z.string().regex(/^(venue|company):[0-9a-f-]{36}$/, "NG にする会場か取引先を選んでください"),
  reason: z.string().trim(),
});

export async function addNg(input: z.input<typeof ngSchema>): Promise<ActionResult> {
  await assertMember();
  const parsed = ngSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const [kind, targetId] = parsed.data.target.split(":");
  const supabase = await createClient();
  const { error } = await supabase.from("staff_ng").insert({
    staff_id: parsed.data.staffId,
    venue_id: kind === "venue" ? targetId : null,
    company_id: kind === "company" ? targetId : null,
    reason: parsed.data.reason,
  });
  if (error) return fail(error.code === "23505" ? "すでに NG に登録されています。" : dbErrorMessage(error));
  revalidatePath(`/staff/${parsed.data.staffId}`);
  return ok("NG に追加しました");
}

export async function removeNg(staffId: string, ngId: string): Promise<ActionResult> {
  await assertMember();
  const supabase = await createClient();
  const { error } = await supabase.from("staff_ng").delete().eq("id", ngId);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath(`/staff/${staffId}`);
  return ok("NG を外しました");
}

const noteSchema = z.object({
  staffId: z.uuid(),
  date: z.iso.date("日付を選んでください"),
  kind: z.enum(["last_minute_cancel", "late", "trouble", "good", "other"]),
  memo: z.string().trim().min(1, "内容を入力してください"),
});

export async function addNote(input: z.input<typeof noteSchema>): Promise<ActionResult> {
  await assertMember();
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const supabase = await createClient();
  const { error } = await supabase
    .from("staff_notes")
    .insert({ staff_id: parsed.data.staffId, date: parsed.data.date, kind: parsed.data.kind, memo: parsed.data.memo });
  if (error) return fail(dbErrorMessage(error));
  revalidatePath(`/staff/${parsed.data.staffId}`);
  return ok("メモを追加しました");
}

// ---------------------------------------------------------------------------
// ★ お金・契約（オーナーのみ）
// ---------------------------------------------------------------------------

const privateSchema = z.object({
  staffId: z.uuid(),
  base_daily_rate: z.number().int().min(0, "基本日当は0円以上にしてください").nullable(),
  withholding_method: z.enum(["none", "fee", "sales_agent"]),
  invoice_number: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase().replace(/[\s-]/g, ""))
    .refine((v) => v === "" || /^T\d{13}$/.test(v), "インボイス登録番号は「T」＋13桁の数字です"),
  contract_date: z.union([z.iso.date(), z.literal("")]),
  bank_name: z.string().trim(),
  bank_branch: z.string().trim(),
  account_type: z.union([z.enum(["ordinary", "checking"]), z.literal("")]),
  account_number: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{1,8}$/.test(v), "口座番号は数字8桁までです"),
  account_holder_kana: z.string().trim(),
});

export type StaffPrivateInput = z.input<typeof privateSchema>;

export async function saveStaffPrivate(input: StaffPrivateInput): Promise<ActionResult> {
  await assertOwner();
  const parsed = privateSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { staffId, ...v } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("staff_private").upsert({
    staff_id: staffId,
    base_daily_rate: v.base_daily_rate,
    withholding_method: v.withholding_method,
    invoice_number: v.invoice_number || null,
    contract_date: v.contract_date || null,
    bank_name: v.bank_name,
    bank_branch: v.bank_branch,
    account_type: v.account_type || null,
    account_number: v.account_number,
    account_holder_kana: v.account_holder_kana,
  });
  if (error) return fail(dbErrorMessage(error));
  revalidatePath(`/staff/${staffId}`);
  return ok("保存しました");
}

/** 契約書PDFのアップロード（非公開の保管場所、オーナーのみ） */
export async function uploadContract(staffId: string, formData: FormData): Promise<ActionResult> {
  await assertOwner();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("PDF ファイルを選んでください");
  if (file.type !== "application/pdf") return fail("PDF ファイルだけアップロードできます");
  if (file.size > 10 * 1024 * 1024) return fail("10MB までのファイルにしてください");

  const supabase = await createClient();
  const path = `staff/${staffId}/${Date.now()}.pdf`;
  const { error: upError } = await supabase.storage.from("contracts").upload(path, file, { contentType: "application/pdf" });
  if (upError) return fail("アップロードできませんでした");
  const { error } = await supabase.from("staff_private").upsert({ staff_id: staffId, contract_file_path: path });
  if (error) return fail(dbErrorMessage(error));
  revalidatePath(`/staff/${staffId}`);
  return ok("契約書をアップロードしました");
}
