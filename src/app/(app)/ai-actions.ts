"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, fail } from "@/lib/action-result";
import { executeProposal, type ProposalKind, type ProposalUndo } from "@/lib/ai/proposals";
import { assertMember } from "@/lib/auth";
import { todayJst } from "@/lib/date";
import { createClient } from "@/lib/supabase/server";
import { removeOffer } from "./events/actions";
import { undoActivity } from "./sales/activity-actions";

const KINDS = ["reports", "availability", "activity", "offers", "events", "slots", "screening", "reassign"] as const satisfies readonly ProposalKind[];

/** AI の確認カードの「登録する」。中身はもう一度確かめてから、ログイン中の人の権限で登録する */
export async function runAiProposal(kind: ProposalKind, payload: unknown): Promise<ActionResult<{ undo?: ProposalUndo }>> {
  const user = await assertMember();
  if (!KINDS.includes(kind)) return fail("この登録はできません");
  const supabase = await createClient();
  const r = await executeProposal({ supabase, user, today: todayJst() }, kind, payload);
  revalidatePath("/", "layout");
  return r;
}

const undoSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("activity"), id: z.uuid(), before: z.object({ status: z.string(), next_action_date: z.string().nullable(), next_action: z.string() }) }),
  z.object({ kind: z.literal("offers"), ids: z.array(z.uuid()).min(1).max(30) }),
]);

/** 「元に戻す」（営業の記録・打診） */
export async function undoAiProposal(undo: ProposalUndo): Promise<ActionResult> {
  await assertMember();
  const u = undoSchema.safeParse(undo);
  if (!u.success) return fail("元に戻せません");
  if (u.data.kind === "activity") return undoActivity(u.data.id, u.data.before as Parameters<typeof undoActivity>[1]);
  for (const id of u.data.ids) {
    const r = await removeOffer(id);
    if (!r.ok) return r;
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "打診を取り消しました" };
}
