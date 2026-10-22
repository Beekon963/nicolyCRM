/**
 * CRM で入れたものをいつものシートにも書く（書き戻し。Phase 19）。
 *
 * 2分ごとの定期実行（/api/cron/sheet-writeback）と「今すぐ書く」から呼ばれる。
 * - 待ち行列 sheet_writes（トリガーが入れた「書き直すマス」）のうち、印が付いてから1分たったものを見る
 * - CRM の今の状態を読み直し、今月・来月のタブの同じマス（場所・シフト・現場・人数）と比べて、違うときだけ書く
 *   （sheet-writeback-plan.ts。シートから読んだ分は同じなので何も書かない）
 * - 設定「行がない人・取引先は行を足す」（Phase 20）がオンなら、シートに行がない人・取引先の組（3行）を
 *   その段のいちばん下に足してから書く。似た名前の行がもうあるとき（名字だけなど）は足さずに知らせる
 * - Google の設定（サービスアカウント。編集者）が必要。ないときは書かずに「書けなかった」と残す
 * 単価の行には触らない。金額は扱わない。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayJst } from "@/lib/date";
import { getAccessToken, readServiceAccount, SheetError, SheetsClient } from "@/lib/google/sheets";
import { venueKey } from "@/lib/import/line-plan";
import { layoutMonthSheet, NO_HEADER_WARNING, NO_LABELS_WARNING, type SheetLayout } from "@/lib/import/month-sheet";
import { type Named, nearClientRows, nearStaffRows, type StaffNamed } from "@/lib/import/name-match";
import { syncMonths, tabTitle } from "@/lib/import/sheet-sync-plan";
import { type CellWrite, copiedFormulas, detectSymbols, findClientBlocks, findStaffBlock, type ItemResult, planCellWrites, planNewBlock, type WriteItem } from "@/lib/import/sheet-writeback-plan";
import { getSheetSyncSettings } from "@/lib/sheet-sync";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;
type Pending = { id: number; kind: "staff_day" | "availability" | "client_day"; ref_id: string; date: string };
type AliasRow = { kind: string; sheet_name: string; target_id: string | null };
type StaffRow = StaffNamed & { station: string; rank: string };

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
function spellings(aliases: AliasRow[], kind: "staff" | "venue" | "client", id: string, crmName: string): string[] {
  const fromAlias = aliases.filter((a) => a.kind === kind && a.target_id === id).map((a) => a.sheet_name);
  return [...new Set([...fromAlias, crmName])].filter(Boolean);
}

type AddRowsInput = {
  client: SheetsClient;
  tab: string;
  values: string[][];
  lay: SheetLayout;
  rows: Pending[];
  staff: Map<string, StaffRow>;
  clients: Map<string, Named>;
  aliases: AliasRow[];
};

/**
 * シートに行がない人・取引先の組を足す（Phase 20）。足せなかったものは理由を結果に入れ、そのマスは書かない。
 * 足したあとはタブを読み直す（行の位置が変わるため）
 */
async function addMissingRows(input: AddRowsInput): Promise<{ values: string[][]; lay: SheetLayout; results: ItemResult[]; added: Set<string> }> {
  const { client, tab, rows, staff, clients, aliases } = input;
  let { values, lay } = input;
  const results: ItemResult[] = [];
  const added = new Set<string>();
  const aliased = new Set(aliases.map((a) => a.sheet_name));
  const roster: StaffNamed[] = [...staff.values()];
  const clientList: Named[] = [...clients.values()];
  const spell = (kind: "staff" | "client", id: string) => spellings(aliases, kind, id, (kind === "staff" ? staff.get(id)?.name : clients.get(id)?.name) ?? "");
  const itemsOf = (ref: string, kind: "staff" | "client") => rows.filter((p) => p.ref_id === ref && (kind === "client") === (p.kind === "client_day"));
  const failAll = (ref: string, kind: "staff" | "client", message: string) => results.push(...itemsOf(ref, kind).map((p) => ({ id: p.id, status: "failed" as const, message })));
  let sheetId: number | null | undefined;

  const refs: { kind: "staff" | "client"; id: string }[] = [
    ...[...new Set(rows.filter((p) => p.kind === "client_day").map((p) => p.ref_id))].map((id) => ({ kind: "client" as const, id })),
    ...[...new Set(rows.filter((p) => p.kind !== "client_day").map((p) => p.ref_id))].map((id) => ({ kind: "staff" as const, id })),
  ];
  for (const { kind, id } of refs) {
    const names = spell(kind, id);
    if (kind === "client" ? findClientBlocks(lay, names).length > 0 : findStaffBlock(lay, names)) continue;
    // 足す行に書く名前は CRM の名前（覚えた書き方ではなく）
    const name = (kind === "staff" ? staff.get(id)?.name : clients.get(id)?.name) ?? "";
    if (!name) continue;
    const label = kind === "staff" ? `${name}さん` : `取引先「${name}」`;
    // 似た名前の行（名字だけ・「株式会社」の違いなど）があるときは足さない（二重の行を作らないため）
    const near = kind === "staff" ? nearStaffRows(id, lay.staffBlocks.map((b) => b.name), roster, aliased) : nearClientRows(id, lay.clientBlocks.map((b) => b.name), clientList, aliased);
    if (near.length) {
      failAll(id, kind, `${name}: シートの「${near.join("」「")}」の行が${kind === "staff" ? "この人" : "この取引先"}かもしれないので、行は足しませんでした（合わない名前の対応づけで決めてください）`);
      continue;
    }
    const s = kind === "staff" ? staff.get(id) : null;
    const nb = planNewBlock(values, lay, kind === "staff" ? { kind, name, rank: s?.rank ?? "", station: s?.station ?? "" } : { kind, name });
    if (!nb) {
      failAll(id, kind, `${name}: シートに${kind === "staff" ? "スタッフ" : "取引先"}の行が1組もないので、行を足せません（最初の1組はシートで作ってください）`);
      continue;
    }
    try {
      sheetId ??= await client.sheetIdOf(tab);
      if (sheetId == null) throw new SheetError(`「${tab}」タブが見つかりません`);
      const template = await client.readFormulas(tab, nb.templateRow, 3);
      await client.insertRows(sheetId, nb.at, 3, nb.templateRow);
      await client.writeCells(tab, nb.cells);
      const formulas = copiedFormulas(template, lay, nb.templateRow, nb.at);
      if (formulas.length) await client.writeCells(tab, formulas, { formulas: true });
      values = await client.readValues(tab);
      const next = layoutMonthSheet(values);
      if ("error" in next) throw new SheetError("行を足したあとのタブが読めませんでした");
      lay = next;
      added.add(id);
    } catch (e) {
      console.error("[sheet-writeback] add rows", e);
      failAll(id, kind, `${label}の行を足せませんでした: ${e instanceof SheetError ? e.message : "シートに書けませんでした。時間をおいてもう一度試してください"}`);
      // 途中で止まったときは、いまのタブを読み直してから残りを書く
      try {
        values = await client.readValues(tab);
        const next = layoutMonthSheet(values);
        if (!("error" in next)) lay = next;
      } catch {
        /* 読めなければ、前に読んだ中身のまま進む */
      }
      break;
    }
  }
  return { values, lay, results, added };
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

  // 名前・対応づけ（名簿と取引先は全員分。似た名前の行があるかの確認に使う）
  const [{ data: staffRows }, { data: clientRows }, { data: venueRows }, { data: aliasRows }] = await Promise.all([
    admin.from("staff").select("id, name, kana, line_name, nearest_station, rank:ranks(name)"),
    admin.from("companies").select("id, name").eq("kind", "client"),
    admin.from("venues").select("id, name"),
    admin.from("sheet_name_aliases").select("kind, sheet_name, target_id"),
  ]);
  const aliases: AliasRow[] = aliasRows ?? [];
  const staff = new Map<string, StaffRow>((staffRows ?? []).map((s) => [s.id, { id: s.id, name: s.name, kana: s.kana, line_name: s.line_name, station: s.nearest_station ?? "", rank: one(s.rank)?.name ?? "" }]));
  const clients = new Map<string, Named>((clientRows ?? []).map((c) => [c.id, { id: c.id, name: c.name }]));
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
      let values = await client.readValues(tab);
      const first = layoutMonthSheet(values);
      if ("error" in first) {
        results.push(...rows.map((p) => ({ id: p.id, status: "skipped" as const, message: `「${tab}」: ${first.error === "no_header" ? NO_HEADER_WARNING : NO_LABELS_WARNING}` })));
        continue;
      }
      let lay: SheetLayout = first;
      // 行がない人・取引先の組を足す（設定がオンのとき）
      const added = new Set<string>();
      if (settings.addRows) {
        const r = await addMissingRows({ client, tab, values, lay, rows, staff, clients, aliases });
        values = r.values;
        lay = r.lay;
        results.push(...r.results);
        for (const id of r.added) added.add(id);
      }
      const settled = new Set(results.map((r) => r.id));
      // 名簿・取引先から消えた人の分は書かない
      const exists = (p: Pending) => (p.kind === "client_day" ? clients.has(p.ref_id) : staff.has(p.ref_id));
      results.push(...rows.filter((p) => !settled.has(p.id) && !exists(p)).map((p) => ({ id: p.id, status: "skipped" as const, message: "名簿・取引先から消えた分なので書きません" })));
      const todo = rows.filter((p) => !settled.has(p.id) && exists(p));
      // CRM の今の状態
      const dates = [...new Set(todo.map((p) => p.date))];
      const sIds = [...new Set(todo.filter((p) => p.kind !== "client_day").map((p) => p.ref_id))];
      const cIds = [...new Set(todo.filter((p) => p.kind === "client_day").map((p) => p.ref_id))];
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
      const items: WriteItem[] = todo.map((p) => {
        const k = `${p.ref_id}|${p.date}`;
        if (p.kind === "staff_day") return { id: p.id, kind: "staff_day", date: p.date, staffNames: spellings(aliases, "staff", p.ref_id, staff.get(p.ref_id)?.name ?? ""), venues: [...new Set(placeOf.get(k) ?? [])] };
        if (p.kind === "availability") return { id: p.id, kind: "availability", date: p.date, staffNames: spellings(aliases, "staff", p.ref_id, staff.get(p.ref_id)?.name ?? ""), status: avOf.get(k) ?? null };
        return { id: p.id, kind: "client_day", date: p.date, clientNames: spellings(aliases, "client", p.ref_id, clients.get(p.ref_id)?.name ?? ""), events: evOf.get(k) ?? [] };
      });
      const plan = planCellWrites(values, lay, items, { symbols: detectSymbols(values, lay), knownVenueKeys });
      const writes: CellWrite[] = plan.writes;
      for (let i = 0; i < writes.length; i += 500) await client.writeCells(tab, writes.slice(i, i + 500));
      written += writes.length;
      const refOf = new Map(todo.map((p) => [p.id, p.ref_id]));
      results.push(...plan.results.map((r) => (added.has(refOf.get(r.id) ?? "") ? { ...r, message: `行を足しました。${r.message}` } : r)));
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
