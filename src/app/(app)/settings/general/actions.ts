"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  availabilityDeadlineDay: z.coerce.number().int().min(1, "締切日は1〜28日にしてください").max(28, "締切日は1〜28日にしてください"),
  reportWindowDays: z.coerce.number().int().min(0, "期限は0〜31日にしてください").max(31, "期限は0〜31日にしてください"),
  name: z.string().trim(),
  address: z.string().trim(),
  phone: z.string().trim(),
  email: z.string().trim(),
});

export async function saveGeneralSettings(input: z.input<typeof schema>): Promise<ActionResult> {
  await assertOwner();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("settings").upsert([
    { key: "availability_deadline_day", value: d.availabilityDeadlineDay },
    { key: "report_window_days", value: d.reportWindowDays },
    { key: "company_profile", value: { name: d.name, address: d.address, phone: d.phone, email: d.email } },
  ]);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/", "layout");
  return ok("保存しました");
}
