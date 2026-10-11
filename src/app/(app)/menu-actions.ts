"use server";

import { assertMember } from "@/lib/auth";
import { getMenuCounts } from "@/lib/data/home";

/** メニューに出す「待っている件数」（実績確認・経費・稼働可能日）。画面を移るたびに聞く */
export async function getMenuCountsAction(): Promise<Record<string, { count: number; late: boolean }>> {
  await assertMember();
  return getMenuCounts();
}
