"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const block = z.string().max(2000, "文面が長すぎます");
const schema = z.object({
  name: z.string().trim().min(1, "フォーマットの名前を入れてください").max(50, "名前が長すぎます"),
  companyId: z.uuid().nullable(),
  forStaff: z.boolean(),
  isActive: z.boolean(),
  header: block,
  eventBlock: block,
  personBlock: block,
  footer: block,
  startBlock: block.optional(),
});
export type ReportFormatInput = z.input<typeof schema>;

/** 日報のフォーマットを保存する（id がなければ新しく作る）。オーナーだけ */
export async function saveReportFormat(id: string | null, input: ReportFormatInput): Promise<ActionResult<{ id: string }>> {
  await assertOwner();
  const p = schema.safeParse(input);
  if (!p.success) return fail(p.error.issues[0].message);
  const v = p.data;
  if (![v.header, v.eventBlock, v.personBlock, v.footer].some((b) => b.trim())) return fail("どこかに文面を入れてください");
  const row = {
    name: v.name,
    company_id: v.companyId,
    for_staff: v.forStaff,
    is_active: v.isActive,
    header: v.header,
    event_block: v.eventBlock,
    person_block: v.personBlock,
    footer: v.footer,
    start_block: v.startBlock ?? "",
  };
  const supabase = await createClient();
  const res = id
    ? await supabase.from("report_formats").update(row).eq("id", id).select("id").single()
    : await supabase.from("report_formats").insert(row).select("id").single();
  if (res.error) return fail(dbErrorMessage(res.error));
  revalidatePath("/settings/report-formats");
  revalidatePath("/results/daily");
  return ok(id ? "保存しました" : "フォーマットを作りました", { id: res.data.id });
}
