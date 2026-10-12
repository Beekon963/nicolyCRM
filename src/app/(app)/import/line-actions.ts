"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionResult, dbErrorMessage, fail, ok } from "@/lib/action-result";
import { assertOwner } from "@/lib/auth";
import { isCount } from "@/lib/count";
import { todayJst } from "@/lib/date";
import { getMasters } from "@/lib/data/masters";
import { createClient } from "@/lib/supabase/server";

/**
 * LINE のトーク履歴から過去の件数の報告を取り込む（Phase 11。オーナーのみ）。
 * 1回に送るのは数十件ずつ（画面が分けて送る）。トーク履歴そのものは受け取らない
 *
 * 1件ごとに:
 * 1. その日・その会場の現場を探す。なければ「記録のみ（件数の記録だけ）」の現場を作る（お金の計算には入らない）
 * 2. 人ごとに、その日に確定している稼働を探す（同じ日の別の現場でも、その人の確定した稼働があればそれに入れる）。
 *    なければ確定の稼働を作る。打診中・キャンセルなどのアサインがあればその人は入れない
 * 3. まだ実績のない稼働にだけ、確定した実績（速報と確定に同じ件数）を入れる。もう報告・実績がある人は上書きしない
 */

const entrySchema = z.object({
  date: z.iso.date(),
  venueId: z.uuid(),
  clientId: z.string(),
  label: z.string().max(200),
  people: z
    .array(
      z.object({
        staffId: z.uuid(),
        counts: z.array(z.object({ itemId: z.uuid(), count: z.number().min(0).max(999).refine(isCount) })).max(100),
      }),
    )
    .min(1)
    .max(30),
});

const NOTE = "LINE のトーク履歴から取り込み";

export type LineImportResult = { entered: number; events: number; skipped: { label: string; reason: string }[] };

export async function importLineReports(input: z.input<typeof entrySchema>[]): Promise<ActionResult<LineImportResult>> {
  const me = await assertOwner();
  const parsed = z.array(entrySchema).max(50).safeParse(input);
  if (!parsed.success) return fail("取り込む内容が正しくありません。もう一度ファイルを選んでください");
  const today = todayJst();
  const supabase = await createClient();
  const masters = await getMasters();
  const role = masters.roles.find((r) => r.is_active);
  if (!role) return fail("役割がありません。設定で役割を作ってください");
  const result: LineImportResult = { entered: 0, events: 0, skipped: [] };
  const skip = (label: string, reason: string) => result.skipped.push({ label, reason });
  const staffIds = [...new Set(parsed.data.flatMap((e) => e.people.map((p) => p.staffId)))];
  const { data: staffRows } = await supabase.from("staff").select("id, name").in("id", staffIds);
  const nameOf = new Map((staffRows ?? []).map((s) => [s.id, s.name]));
  const who = (id: string) => nameOf.get(id) ?? "（見つからないスタッフ）";

  for (const e of parsed.data) {
    if (e.date >= today) {
      skip(e.label, "今日より前の日ではありません");
      continue;
    }
    // 1. 現場
    const { data: found } = await supabase.from("events").select("id").eq("venue_id", e.venueId).eq("date", e.date).is("cancelled_at", null).order("created_at").limit(1);
    let eventId = found?.[0]?.id as string | undefined;
    let created = false;
    // 2. 人ごとの稼働（同じ日の確定した稼働があればそれを使う）
    const { data: sameDay } = await supabase
      .from("assignments")
      .select("id, staff_id, status, event_id, event:events!inner(date, cancelled_at)")
      .is("event.cancelled_at", null)
      .in(
        "staff_id",
        e.people.map((p) => p.staffId),
      )
      .eq("event.date", e.date);
    for (const p of e.people) {
      const mine = (sameDay ?? []).filter((a) => a.staff_id === p.staffId);
      const onThis = eventId ? mine.find((a) => a.event_id === eventId) : undefined;
      // 同じ日の別の現場で確定している稼働（会場の書き方が CRM と違うとき）
      const confirmed = mine.find((a) => a.status === "confirmed");
      let assignmentId: string | undefined;
      if (onThis && onThis.status !== "confirmed") {
        skip(`${e.label} ${who(p.staffId)}`, `この現場のアサインが確定ではありません`);
        continue;
      }
      if (onThis) assignmentId = onThis.id;
      else if (confirmed) assignmentId = confirmed.id;
      else {
        if (!eventId) {
          if (!e.clientId) {
            skip(e.label, "現場がなく、作る現場の取引先が決まっていません");
            break;
          }
          const { data: ev, error } = await supabase
            .from("events")
            .insert({ client_id: e.clientId, venue_id: e.venueId, date: e.date, report_required: false, counts_only: true, notes: NOTE })
            .select("id")
            .single();
          if (error || !ev) {
            skip(e.label, dbErrorMessage(error));
            break;
          }
          eventId = ev.id;
          created = true;
          await supabase.from("event_requirements").insert({ event_id: ev.id, role_id: role.id, required_count: e.people.length });
        }
        const { data: a, error } = await supabase.from("assignments").insert({ event_id: eventId, staff_id: p.staffId, role_id: role.id, status: "confirmed" }).select("id").single();
        if (error || !a) {
          skip(`${e.label} ${who(p.staffId)}`, `${dbErrorMessage(error)}`);
          continue;
        }
        assignmentId = a.id;
      }
      // 3. 実績（もうある人は上書きしない）
      const [{ data: rep }, { count: itemCount }] = await Promise.all([
        supabase.from("reports").select("submitted_at, confirmed_at").eq("assignment_id", assignmentId).maybeSingle(),
        supabase.from("report_items").select("item_id", { count: "exact", head: true }).eq("assignment_id", assignmentId),
      ]);
      if (rep?.confirmed_at || (itemCount ?? 0) > 0) {
        skip(`${e.label} ${who(p.staffId)}`, `もう実績があります`);
        continue;
      }
      const now = new Date().toISOString();
      const { error: re } = await supabase
        .from("reports")
        .upsert({ assignment_id: assignmentId, submitted_at: rep?.submitted_at ?? now, confirmed_at: now, confirmed_by: me.id, source: "admin", comment: NOTE });
      if (re) {
        skip(`${e.label} ${who(p.staffId)}`, `${dbErrorMessage(re)}`);
        continue;
      }
      if (p.counts.length) {
        const { error: ie } = await supabase
          .from("report_items")
          .insert(p.counts.map((c) => ({ assignment_id: assignmentId!, item_id: c.itemId, reported_count: c.count, confirmed_count: c.count })));
        if (ie) {
          skip(`${e.label} ${who(p.staffId)}`, `${dbErrorMessage(ie)}`);
          continue;
        }
      }
      result.entered++;
    }
    if (created) result.events++;
  }
  revalidatePath("/", "layout");
  return ok(`${result.entered}人分の実績を入れました`, result);
}

/** 現場詳細（【案件詳細】）を会場のメモに足す（同じ文がもう入っていれば足さない） */
export async function addVenueDetails(input: { venueId: string; date: string; body: string }[]): Promise<ActionResult<{ updated: number }>> {
  await assertOwner();
  const parsed = z.array(z.object({ venueId: z.uuid(), date: z.iso.date(), body: z.string().trim().min(1).max(5000) })).max(200).safeParse(input);
  if (!parsed.success) return fail("内容が正しくありません");
  const supabase = await createClient();
  let updated = 0;
  for (const d of parsed.data) {
    const { data: v } = await supabase.from("venues").select("memo").eq("id", d.venueId).maybeSingle();
    if (!v) continue;
    if (v.memo.includes(d.body)) continue;
    const head = `【LINE の現場詳細（${d.date.replaceAll("-", "/")}）】`;
    const { error } = await supabase
      .from("venues")
      .update({ memo: [v.memo.trim(), `${head}\n${d.body}`].filter(Boolean).join("\n\n") })
      .eq("id", d.venueId);
    if (error) return fail(dbErrorMessage(error));
    updated++;
  }
  revalidatePath("/venues", "layout");
  return ok(`${updated}か所の会場のメモに入れました`, { updated });
}
