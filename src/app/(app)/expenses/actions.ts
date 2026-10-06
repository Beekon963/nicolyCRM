"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** 交通費・経費の承認 / 却下 / 未承認に戻す（オーナー・管理者。要件 §3） */
export async function reviewExpenses(ids: string[], status: "approved" | "rejected" | "pending", reason = ""): Promise<ActionResult> {
  const me = await assertMember();
  if (!z.array(z.uuid()).min(1).safeParse(ids).success) return fail("対象を選んでください");
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("expenses")
    .update(
      status === "pending"
        ? { status, reviewed_by: null, reviewed_at: null, reject_reason: "" }
        : { status, reviewed_by: me.id, reviewed_at: new Date().toISOString(), reject_reason: status === "rejected" ? reason.trim() : "" },
      { count: "exact" },
    )
    .in("id", ids);
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/expenses");
  revalidatePath("/");
  const label = { approved: "承認しました", rejected: "却下しました", pending: "未承認に戻しました" }[status];
  return ok(`${count ?? ids.length}件 ${label}`);
}
