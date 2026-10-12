"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, fail } from "@/lib/action-result";
import { assertMember } from "@/lib/auth";
import { formatTimeRange } from "@/lib/templates";
import { todayJst } from "@/lib/date";
import { getMasters } from "@/lib/data/masters";
import { enterReports } from "@/lib/data/report-entry";
import { createClient } from "@/lib/supabase/server";

/** 「LINEの報告を変換 → 実績に入れる」で選ぶ現場（その取引先・その日。中止は出さない）と、確定した人 */
export type ConvertTarget = {
  eventId: string;
  venue: string;
  time: string;
  people: { assignmentId: string; name: string; role: string; state: "" | "報告ずみ" | "確定ずみ" }[];
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export async function loadConvertTargets(clientId: string, date: string): Promise<ConvertTarget[]> {
  await assertMember();
  if (!z.uuid().safeParse(clientId).success || !z.iso.date().safeParse(date).success) return [];
  const supabase = await createClient();
  const [masters, { data }] = await Promise.all([
    getMasters(),
    supabase
      .from("events")
      .select("id, start_time, end_time, venue:venues(name), assignments(id, status, role_id, staff:staff(name, kana), report:reports(submitted_at, confirmed_at))")
      .eq("client_id", clientId)
      .eq("date", date)
      .is("cancelled_at", null)
      .order("start_time"),
  ]);
  return (data ?? []).map((e) => ({
    eventId: e.id,
    venue: one(e.venue)?.name ?? "",
    time: formatTimeRange(e.start_time, e.end_time),
    people: e.assignments
      .filter((a) => a.status === "confirmed")
      .map((a) => {
        const r = one(a.report);
        return {
          kana: one(a.staff)?.kana ?? "",
          person: {
            assignmentId: a.id,
            name: one(a.staff)?.name ?? "",
            role: masters.roleById.get(a.role_id)?.name ?? "",
            state: (r?.confirmed_at ? "確定ずみ" : r?.submitted_at ? "報告ずみ" : "") as ConvertTarget["people"][number]["state"],
          },
        };
      })
      .sort((a, b) => a.kana.localeCompare(b.kana, "ja"))
      .map((x) => x.person),
  }));
}

const schema = z.object({
  entries: z
    .array(
      z.object({
        assignment_id: z.uuid(),
        counts: z.array(z.object({ name: z.string().trim().min(1), count: z.number().int().min(0).max(999) })).max(100),
        comment: z.string().trim().max(1000),
      }),
    )
    .min(1, "入れる人を選んでください")
    .max(30),
});

/** 変換した報告を、選んだ人の速報として入れる（項目は名前で受け取り、獲得項目にない名前は入れない） */
export async function enterConvertedReports(input: z.input<typeof schema>): Promise<ActionResult> {
  await assertMember();
  const p = schema.safeParse(input);
  if (!p.success) return fail(p.error.issues[0].message);
  const masters = await getMasters();
  const idOf = new Map(masters.items.map((i) => [i.name, i.id]));
  const entries = [];
  for (const e of p.data.entries) {
    const sum = new Map<string, number>();
    for (const c of e.counts) {
      const id = idOf.get(c.name);
      if (!id) return fail(`「${c.name}」は獲得項目にありません。項目を選び直してください`);
      sum.set(id, (sum.get(id) ?? 0) + c.count);
    }
    entries.push({ assignment_id: e.assignment_id, counts: [...sum].map(([item_id, count]) => ({ item_id, count })), comment: e.comment });
  }
  const r = await enterReports({ supabase: await createClient(), today: todayJst() }, entries);
  if (r.ok) {
    revalidatePath("/results", "layout");
    revalidatePath("/");
  }
  return r;
}
