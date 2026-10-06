"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type Kind = Database["public"]["Enums"]["template_kind"];
const KINDS = ["offer", "confirm", "reminder", "availability_request", "availability_reminder", "report_request"] as const;

export async function saveTemplate(kind: Kind, body: string): Promise<ActionResult> {
  await assertOwner();
  const parsed = z.object({ kind: z.enum(KINDS), body: z.string().trim().min(1, "文面が空です").max(2000, "文面が長すぎます") }).safeParse({ kind, body });
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const supabase = await createClient();
  const { error } = await supabase.from("message_templates").upsert({ kind: parsed.data.kind, body: parsed.data.body });
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/settings/templates");
  return ok("保存しました");
}
