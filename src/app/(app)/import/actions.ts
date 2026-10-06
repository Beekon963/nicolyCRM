"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, type ActionResult } from "@/lib/action-result";
import { assertOwner } from "@/lib/auth";
import { parseBankCell } from "@/lib/import/bank";
import type { ImportTarget } from "@/lib/import/fields";
import { IMPORT_MAPS, loadContext, validateRows, type PreviewRow } from "@/lib/import/validate";
import { createClient } from "@/lib/supabase/server";

const { STATUS, WITHHOLDING, nk, split, yen } = IMPORT_MAPS;
const targetSchema = z.enum(["staff", "client", "partner", "venue"]);
const rowsSchema = z.array(z.record(z.string(), z.string())).max(1000, "一度に取り込めるのは1000行までです");

/** プレビュー: エラーと重複候補を出す（まだ何も保存しない） */
export async function previewImport(target: ImportTarget, rows: Record<string, string>[]): Promise<ActionResult<PreviewRow[]>> {
  await assertOwner();
  const t = targetSchema.safeParse(target);
  const r = rowsSchema.safeParse(rows);
  if (!t.success || !r.success) return fail(r.error?.issues[0].message ?? "取り込めない形式です");
  const ctx = await loadContext();
  return { ok: true, data: validateRows(t.data, r.data, ctx, true) };
}

export type ImportReport = { created: number; updated: number; skipped: number; errors: { row: number; message: string }[] };

/**
 * 取り込みを実行する（オーナーのみ。要件 §4.13）。
 * 重複候補は decisions で「上書き」と選んだ行だけ更新し、それ以外は飛ばす。エラーの行は取り込まない。
 */
export async function runImport(target: ImportTarget, rows: Record<string, string>[], overwrite: number[]): Promise<ActionResult<ImportReport>> {
  await assertOwner();
  const t = targetSchema.safeParse(target);
  const r = rowsSchema.safeParse(rows);
  if (!t.success || !r.success) return fail("取り込めない形式です");
  const supabase = await createClient();
  const ctx = await loadContext();
  const preview = validateRows(t.data, r.data, ctx, true);
  const report: ImportReport = { created: 0, updated: 0, skipped: 0, errors: [] };
  const areaIds = new Map(ctx.areas.map((a) => [nk(a.name), a.id]));

  async function areaId(name: string) {
    if (!name) return null;
    const k = nk(name);
    if (areaIds.has(k)) return areaIds.get(k)!;
    const { data } = await supabase.from("areas").insert({ name, sort_order: 100 + areaIds.size }).select("id").single();
    if (data) areaIds.set(k, data.id);
    return data?.id ?? null;
  }

  for (const p of preview) {
    const line = p.index + 2; // 1行目は見出し
    if (p.errors.length) {
      report.errors.push({ row: line, message: p.errors.join(" / ") });
      continue;
    }
    if (p.inFileDuplicateOf != null || (p.duplicate && !overwrite.includes(p.index))) {
      report.skipped++;
      continue;
    }
    const v = p.values;
    const existingId = p.duplicate?.id;
    try {
      if (t.data === "staff") {
        const rank = ctx.ranks.find((x) => nk(x.name) === nk(v.rank ?? ""));
        const values = {
          name: v.name,
          ...(v.kana !== undefined && { kana: v.kana }),
          ...(v.phone !== undefined && { phone: v.phone }),
          ...(v.line_name !== undefined && { line_name: v.line_name }),
          ...(v.nearest_station !== undefined && { nearest_station: v.nearest_station }),
          ...(v.rank !== undefined && { rank_id: rank?.id ?? null }),
          ...(v.status !== undefined && { status: STATUS[v.status ?? ""] }),
          ...(v.memo !== undefined && { memo: v.memo }),
        };
        const { data, error } = existingId
          ? await supabase.from("staff").update(values).eq("id", existingId).select("id").single()
          : await supabase.from("staff").insert(values).select("id").single();
        if (error || !data) throw new Error("保存できませんでした");
        const staffId = data.id;
        if (v.roles !== undefined) {
          await supabase.from("staff_roles").delete().eq("staff_id", staffId);
          const ids = split(v.roles).map((n) => ctx.roles.find((x) => nk(x.name) === nk(n))!.id);
          if (ids.length) await supabase.from("staff_roles").insert(ids.map((role_id) => ({ staff_id: staffId, role_id })));
        }
        if (v.areas !== undefined) {
          await supabase.from("staff_areas").delete().eq("staff_id", staffId);
          const ids = (await Promise.all(split(v.areas).map(areaId))).filter((x): x is string => Boolean(x));
          if (ids.length) await supabase.from("staff_areas").insert([...new Set(ids)].map((area_id) => ({ staff_id: staffId, area_id })));
        }
        // ★ お金・口座（オーナーのみ）
        const priv: Record<string, unknown> = { staff_id: staffId };
        const rate = v.base_daily_rate ? Number(yen(v.base_daily_rate)) : rank ? ctx.rankRates.get(rank.id) : undefined;
        if (rate != null && (v.base_daily_rate || !existingId)) priv.base_daily_rate = rate;
        if (v.withholding_method) priv.withholding_method = WITHHOLDING[v.withholding_method];
        if (v.invoice_number) priv.invoice_number = v.invoice_number.toUpperCase().replace(/[\s-]/g, "");
        if (v.bank_cell) Object.assign(priv, parseBankCell(v.bank_cell));
        if (v.account_holder_kana) priv.account_holder_kana = v.account_holder_kana;
        if (Object.keys(priv).length > 1) {
          const { error: pErr } = await supabase.from("staff_private").upsert(priv as never);
          if (pErr) throw new Error("お金・口座の項目を保存できませんでした");
        }
      } else if (t.data === "venue") {
        const values = {
          name: v.name,
          ...(v.kana !== undefined && { kana: v.kana }),
          ...(v.address !== undefined && { address: v.address }),
          ...(v.nearest_station !== undefined && { nearest_station: v.nearest_station }),
          ...(v.prefecture !== undefined && { prefecture: v.prefecture }),
          ...(v.area !== undefined && { area_id: await areaId(v.area) }),
          ...(v.access_notes !== undefined && { access_notes: v.access_notes }),
          ...(v.green_room !== undefined && { green_room: v.green_room }),
          ...(v.parking !== undefined && { parking: v.parking }),
          ...(v.memo !== undefined && { memo: v.memo }),
        };
        const { error } = existingId ? await supabase.from("venues").update(values).eq("id", existingId) : await supabase.from("venues").insert(values);
        if (error) throw new Error("保存できませんでした");
      } else {
        const values = {
          name: v.name,
          ...(v.kana !== undefined && { kana: v.kana }),
          ...(v.phone !== undefined && { phone: v.phone }),
          ...(v.address !== undefined && { address: v.address }),
          ...(v.website !== undefined && { website: v.website }),
          ...(v.memo !== undefined && { memo: v.memo }),
        };
        const { data, error } = existingId
          ? await supabase.from("companies").update(values).eq("id", existingId).select("id").single()
          : await supabase
              .from("companies")
              .insert({ ...values, kind: t.data, status: t.data === "client" ? "active" : "not_contacted" })
              .select("id")
              .single();
        if (error || !data) throw new Error("保存できませんでした");
        if (v.contact_name) {
          await supabase.from("contacts").insert({ company_id: data.id, name: v.contact_name, phone: v.contact_phone ?? "", email: v.contact_email ?? "" });
        }
      }
      if (existingId) report.updated++;
      else report.created++;
    } catch (e) {
      report.errors.push({ row: line, message: (e as Error).message });
    }
  }
  revalidatePath("/", "layout");
  return { ok: true, data: report };
}
