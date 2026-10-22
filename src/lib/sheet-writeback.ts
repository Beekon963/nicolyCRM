/**
 * CRM で入れたものをいつものシートにも書く（書き戻し。Phase 19）。
 *
 * 2分ごとの定期実行（/api/cron/sheet-writeback）と「今すぐ書く」から呼ばれる。
 * - 待ち行列 sheet_writes（トリガーが入れた「書き直すマス」）のうち、印が付いてから1分たったものを見る
 * - CRM の今の状態を読み直し、今月・来月のタブの同じマス（場所・シフト・現場・人数）と比べて、違うときだけ書く
 *   （sheet-writeback-plan.ts。シートから読んだ分は同じなので何も書かない）
 * - Google の設定（サービスアカウント。編集者）が必要。ないときは書かずに「書けなかった」と残す
 * 単価の行には触らない。金額は扱わない。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayJst } from "@/lib/date";
import { getAccessToken, readServiceAccount, SheetError, SheetsClient } from "@/lib/google/sheets";
import { venueKey } from "@/lib/import/line-plan";
import { layoutMonthSheet, NO_HEADER_WARNING, NO_LABELS_WARNING } from "@/lib/import/month-sheet";
import { syncMonths, tabTitle } from "@/lib/import/sheet-sync-plan";
import { type CellWrite, detectSymbols, type ItemResult, planCellWrites, type WriteItem } from "@/lib/import/sheet-writeback-plan";
import { getSheetSyncSettings } from "@/lib/sheet-sync";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;
type Pending = { id: number; kind: "staff_day" | "availability" | "client_day"; ref_id: string; date: string };

export type WritebackResult = { ok: boolean; message: string; done: number; skipped: number; failed: number; written: number };

const one = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

/** 結果を待ち行列に書く（同じ結果のものはまとめて） */
async function settle(db: Db, results: ItemResult[]) {
  const now = new Date().toISOString();
  const groups = new Map<string, number[]>();
  for (const r of results) {
    const k = `${r.status}\u0000${r.message}`;
    groups.set(k, [...(groups.get(k) ?? []), r.id]);
  }
  for (const [k, ids] of groups) {
    const [status, message] = k.split("\u0000") as [ItemResult["status"], string];
    for (let i = 0; i < ids.length; i += 500) await db.from("sheet_writes").update({ status, message, processed_at: now }).in("id", ids.slice(i, i + 500));
  }
}

/** 名前の候補（覚えた対応づけのシートの書き方 → CRM の名前の順） */
function spellings(aliases: { kind: string; sheet_name: string; target_id: string | null }[], kind: "staff" | "venue" | "client", id: string, crmName: string): string[] {
  const fromAlias = aliases.filter((a) => a.kind === kind && a.target_id === id).map((a) => a.sheet_name);
  return [...new Set([...fromAlias, crmName])].filter(Boolean);
}

export async function runSheetWriteback(source: "cron" | "button", opts: { fetchImpl?: typeof fetch; now?: Date } = {}): Promise<WritebackResult> {
  const admin = createAdminClient();
  const zero = { done: 0, skipped: 0, failed: 0, written: 0 };
  const settings = await getSheetSyncSettings(admin);
  if (!settings.writeback) {
    // オフのあいだに付いた印は使わない
    await admin.from("sheet_writes").delete().eq("status", "pending");
    return { ok: false, message: "シートへの書き戻しはオフです", ...zero };
  }
  const now = opts.now ?? new Date();
  // 印が付いてから1分たったもの（「元に戻す」で行ったり来たりしないように）。「今すぐ書く」はすぐ
  const q = admin.from("sheet_writes").select("id, kind, ref_id, date").eq("status", "pending").order("created_at").limit(1000);
  const { data: pendingRows } = source === "cron" ? await q.lt("created_at", new Date(now.getTime() - 60_000).toISOString()) : await q;
  const pending = (pendingRows ?? []) as Pending[];
  if (!pending.length) return { ok: true, message: "シートに書くものはありません", ...zero };

  const skipAll = async (message: string, ok = false): Promise<WritebackResult> => {
    await settle(admin, pending.map((p) => ({ id: p.id, status: "skipped", message })));
    return { ok, message, ...zero, skipped: pending.length };
  };
  if (!settings.spreadsheetId) return skipAll("読む元のスプレッドシートが未設定です");
  const sa = readServiceAccount();
  if (!sa) return skipAll("Google の設定（docs/setup.md ⑨ のサービスアカウント）がないので、シートには書けません");

  let client: SheetsClient;
  let titles: string[];
  try {
    client = new SheetsClient(await getAccessToken(sa, opts.fetchImpl), settings.spreadsheetId, sa.client_email, opts.fetchImpl);
    titles = await client.sheetTitles();
  } catch (e) {
    return skipAll(e instanceof SheetError ? e.message : "Google にログインできませんでした");
  }

  // 名前・対応づけ
  const staffIds = [...new Set(pending.filter((p) => p.kind !== "client_day").map((p) => p.ref_id))];
  const clientIds = [...new Set(pending.filter((p) => p.kind === "client_day").map((p) => p.ref_id))];
  const [{ data: staffRows }, { data: clientRows }, { data: venueRows }, { data: aliasRows }] = await Promise.all([
    staffIds.length ? admin.from("staff").select("id, name").in("id", staffIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    clientIds.length ? admin.from("companies").select("id, name").in("id", clientIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    admin.from("venues").select("id, name"),
    admin.from("sheet_name_aliases").select("kind, sheet_name, target_id"),
  ]);
  const aliases = aliasRows ?? [];
  const staffName = new Map((staffRows ?? []).map((s) => [s.id, s.name]));
  const clientName = new Map((clientRows ?? []).map((c) => [c.id, c.name]));
  const venueName = new Map((venueRows ?? []).map((v) => [v.id, v.name]));
  const venueSpelling = (id: string) => spellings(aliases, "venue", id, venueName.get(id) ?? "")[0] ?? "";
  const knownVenueKeys = new Set([...(venueRows ?? []).map((v) => venueKey(v.name)), ...aliases.filter((a) => a.kind === "venue").map((a) => venueKey(a.sheet_name))].filter((k) => k.length >= 2));

  const today = todayJst(now);
  const months = syncMonths(today);
  const results: ItemResult[] = [];
  let written = 0;
  const byMonth = new Map<string, Pending[]>();
  for (const p of pending) byMonth.set(p.date.slice(0, 7), [...(byMonth.get(p.date.slice(0, 7)) ?? []), p]);

  for (const [month, rows] of byMonth) {
    if (!months.includes(month)) {
      results.push(...rows.map((p) => ({ id: p.id, status: "skipped" as const, message: "今月・来月のタブだけ書きます" })));
      continue;
    }
    const tab = tabTitle(month);
    if (!titles.includes(tab)) {
      results.push(...rows.map((p) => ({ id: p.id, status: "skipped" as const, message: `「${tab}」タブがありません` })));
      continue;
    }
    try {
      const values = await client.readValues(tab);
      const lay = layoutMonthSheet(values);
      if ("error" in lay) {
        results.push(...rows.map((p) => ({ id: p.id, status: "skipped" as const, message: `「${tab}」: ${lay.error === "no_header" ? NO_HEADER_WARNING : NO_LABELS_WARNING}` })));
        continue;
      }
      // CRM の今の状態
      const dates = [...new Set(rows.map((p) => p.date))];
      const sIds = [...new Set(rows.filter((p) => p.kind !== "client_day").map((p) => p.ref_id))];
      const cIds = [...new Set(rows.filter((p) => p.kind === "client_day").map((p) => p.ref_id))];
      const [{ data: asg }, { data: av }, { data: ev }] = await Promise.all([
        sIds.length
          ? admin.from("assignments").select("staff_id, event:events!inner(date, venue_id, cancelled_at)").eq("status", "confirmed").in("staff_id", sIds).in("event.date", dates).is("event.cancelled_at", null)
          : Promise.resolve({ data: [] }),
        sIds.length ? admin.from("availability").select("staff_id, date, status").in("staff_id", sIds).in("date", dates) : Promise.resolve({ data: [] }),
        cIds.length ? admin.from("events").select("id, client_id, date, venue_id, requirements:event_requirements(required_count)").in("client_id", cIds).in("date", dates).is("cancelled_at", null).order("created_at") : Promise.resolve({ data: [] }),
      ]);
      const placeOf = new Map<string, string[]>();
      for (const a of asg ?? []) {
        const e = one(a.event);
        if (!e) continue;
        const k = `${a.staff_id}|${e.date}`;
        placeOf.set(k, [...(placeOf.get(k) ?? []), venueSpelling(e.venue_id)]);
      }
      const avOf = new Map((av ?? []).map((r) => [`${r.staff_id}|${r.date}`, r.status]));
      const evOf = new Map<string, { venue: string; required: number }[]>();
      for (const e of ev ?? []) {
        const k = `${e.client_id}|${e.date}`;
        const required = (Array.isArray(e.requirements) ? e.requirements : []).reduce((s, r) => s + (r.required_count ?? 0), 0);
        evOf.set(k, [...(evOf.get(k) ?? []), { venue: venueSpelling(e.venue_id), required }]);
      }
      const items: WriteItem[] = rows.map((p) => {
        const k = `${p.ref_id}|${p.date}`;
        if (p.kind === "staff_day") return { id: p.id, kind: "staff_day", date: p.date, staffNames: spellings(aliases, "staff", p.ref_id, staffName.get(p.ref_id) ?? ""), venues: [...new Set(placeOf.get(k) ?? [])] };
        if (p.kind === "availability") return { id: p.id, kind: "availability", date: p.date, staffNames: spellings(aliases, "staff", p.ref_id, staffName.get(p.ref_id) ?? ""), status: avOf.get(k) ?? null };
        return { id: p.id, kind: "client_day", date: p.date, clientNames: spellings(aliases, "client", p.ref_id, clientName.get(p.ref_id) ?? ""), events: evOf.get(k) ?? [] };
      });
      const plan = planCellWrites(values, lay, items, { symbols: detectSymbols(values, lay), knownVenueKeys });
      const writes: CellWrite[] = plan.writes;
      for (let i = 0; i < writes.length; i += 500) await client.writeCells(tab, writes.slice(i, i + 500));
      written += writes.length;
      results.push(...plan.results);
    } catch (e) {
      const message = e instanceof SheetError ? e.message : "シートに書けませんでした。時間をおいてもう一度試してください";
      results.push(...rows.filter((p) => !results.some((r) => r.id === p.id)).map((p) => ({ id: p.id, status: "failed" as const, message })));
    }
  }
  await settle(admin, results);
  const done = results.filter((r) => r.status === "done").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const parts = [`書いたマス ${written}`, `見たマス ${done}`];
  if (skipped) parts.push(`触らなかった ${skipped}`);
  if (failed) parts.push(`書けなかった ${failed}`);
  return { ok: failed === 0, message: parts.join("・"), done, skipped, failed, written };
}
