"use server";

import { z } from "zod";
import { addBookingToCalendar, removeBookingFromCalendar, trainingError } from "@/lib/data/trainings";
import { createAnonClient } from "@/lib/supabase/server";

/** 研修を予約する（ログインなし。鍵・定員の確認は DB の training_public_book）。控えの鍵を返す（控えの画面 /t/b/控えの鍵） */
export async function bookTraining(token: string, input: { slotId: string; name: string; contact: string; memo: string }): Promise<{ ok: true; cancelToken: string } | { ok: false; message: string }> {
  const p = z
    .object({ slotId: z.uuid(), name: z.string().trim().min(1, trainingError("invalid_input")).max(50, trainingError("invalid_input")), contact: z.string().trim().max(100), memo: z.string().trim().max(500) })
    .safeParse(input);
  if (!p.success) return { ok: false, message: p.error.issues[0].message };
  const { data, error } = await createAnonClient().rpc("training_public_book", {
    p_token: token,
    p_slot_id: p.data.slotId,
    p_name: p.data.name,
    p_contact: p.data.contact,
    p_memo: p.data.memo,
  });
  if (error || !data) return { ok: false, message: trainingError("") };
  const r = data as { ok?: boolean; error?: string; booking_id?: string; cancel_token?: string };
  if (r.error || !r.booking_id || !r.cancel_token) return { ok: false, message: trainingError(r.error ?? "") };
  await addBookingToCalendar(r.booking_id);
  return { ok: true, cancelToken: r.cancel_token };
}

/** 予約した人がキャンセルする（控えの鍵で） */
export async function cancelTraining(key: string): Promise<{ ok: boolean; message: string }> {
  const { data, error } = await createAnonClient().rpc("training_public_cancel", { p_cancel_token: key });
  if (error || !data) return { ok: false, message: trainingError("") };
  const r = data as { ok?: boolean; error?: string; booking_id?: string };
  if (r.error || !r.booking_id) return { ok: false, message: trainingError(r.error ?? "") };
  await removeBookingFromCalendar(r.booking_id);
  return { ok: true, message: "キャンセルしました" };
}
