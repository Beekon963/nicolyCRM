"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "会場名を入力してください"),
  kana: z.string().trim(),
  address: z.string().trim(),
  nearest_station: z.string().trim(),
  prefecture: z.string().trim(),
  area_id: z.string().transform((v) => v || null),
  access_notes: z.string().trim(),
  green_room: z.string().trim(),
  parking: z.string().trim(),
  memo: z.string().trim(),
  is_active: z.boolean(),
});

export type VenueInput = z.input<typeof schema>;

export async function saveVenue(input: VenueInput): Promise<ActionResult<{ id: string }>> {
  await assertMember();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const { id, ...values } = parsed.data;
  const supabase = await createClient();
  const { data, error } = id
    ? await supabase.from("venues").update(values).eq("id", id).select("id").single()
    : await supabase.from("venues").insert(values).select("id").single();
  if (error || !data) return fail(dbErrorMessage(error));
  revalidatePath("/venues", "layout");
  return ok(id ? "保存しました" : "登録しました", { id: data.id });
}
