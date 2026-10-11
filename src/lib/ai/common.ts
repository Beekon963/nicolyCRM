import "server-only";
import { z } from "zod";
import type { AppUser } from "@/lib/auth";
import { diffDays, isDateString, weekdayJa } from "@/lib/date";
import type { createClient } from "@/lib/supabase/server";

/** AI アシスタントの道具で共通に使うもの（Phase 4-4） */

export type Db = Awaited<ReturnType<typeof createClient>>;
export type AiContext = { supabase: Db; user: AppUser; today: string };

export type AiTool = {
  name: string;
  /** 画面に出す「〇〇を調べています」 */
  label: string;
  description: string;
  schema: z.ZodType;
  ownerOnly?: boolean;
  run: (ctx: AiContext, input: never) => Promise<unknown>;
};

/** 道具の中で投げると、AI に「入力を直して」と返す */
export class ToolInputError extends Error {}

export const dateArg = z.string().refine(isDateString, "日付は YYYY-MM-DD の形で入れてください");
export const t5 = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");
export const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
/** 「2026-10-10(土)」 */
export const day = (d: string) => `${d}(${weekdayJa(d)})`;

export function checkRange(from: string, to: string, max: number) {
  if (to < from) throw new ToolInputError("to は from 以降の日付にしてください");
  if (diffDays(from, to) > max) throw new ToolInputError(`期間は ${max} 日までにしてください`);
}
