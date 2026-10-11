"use server";

import { z } from "zod";
import { assertMember } from "@/lib/auth";
import { type DropAlert, loadDropAlerts, markDropAlertsSeen } from "@/lib/data/alerts";

/** キャンセル・当日不稼働のお知らせ（画面が1分ごとに聞く） */
export async function getDropAlerts(): Promise<DropAlert[]> {
  const me = await assertMember();
  return loadDropAlerts(me.id);
}

/** ポップアップを閉じた（ここまで見た） */
export async function seeDropAlerts(upTo: string): Promise<void> {
  const me = await assertMember();
  const parsed = z.iso.datetime({ offset: true }).safeParse(upTo);
  if (!parsed.success) return;
  await markDropAlertsSeen(me.id, parsed.data);
}
