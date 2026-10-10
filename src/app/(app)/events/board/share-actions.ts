"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** 見るだけリンクを作る・作り直す（作り直すと古いリンクはすぐ使えなくなる。オーナーのみ） */
export async function issueShareLink(): Promise<ActionResult> {
  await assertOwner();
  const supabase = await createClient();
  const { error } = await supabase
    .from("share_links")
    .upsert({ kind: "board", token: randomBytes(32).toString("base64url"), is_active: true, rotated_at: new Date().toISOString() }, { onConflict: "kind" });
  if (error) return fail(dbErrorMessage(error));
  revalidatePath("/events/board");
  return ok("見るだけリンクを作りました");
}

/** 見るだけリンクを止める・再開する（オーナーのみ） */
export async function setShareLinkActive(active: boolean): Promise<ActionResult> {
  await assertOwner();
  const supabase = await createClient();
  const { error, count } = await supabase.from("share_links").update({ is_active: active }, { count: "exact" }).eq("kind", "board");
  if (error) return fail(dbErrorMessage(error));
  if (!count) return fail("まだリンクを作っていません");
  revalidatePath("/events/board");
  return ok(active ? "見るだけリンクを再開しました" : "見るだけリンクを止めました");
}
