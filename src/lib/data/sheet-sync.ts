import "server-only";
import { readServiceAccount } from "@/lib/google/sheets";
import { createClient } from "@/lib/supabase/server";
import { EMPTY_UNMATCHED, type SyncReport } from "@/lib/sheet-sync";
import { EMPTY_SUGGESTIONS, suggestForUnmatched, type Suggestions } from "@/lib/import/name-match";
import type { Unmatched } from "@/lib/import/sheet-sync-plan";

export type SheetSyncRun = { ranAt: string; ok: boolean; message: string; report: SyncReport };

export type SheetWriteRow = { at: string; status: "done" | "skipped" | "failed"; message: string; count: number };

export type SheetSyncStatus = {
  enabled: boolean;
  /** CRM で入れたものをシートにも書く（書き戻し。Phase 19） */
  writeback: boolean;
  /** 書き戻しで、シートに行がない人・取引先の行を足す（Phase 20） */
  addRows: boolean;
  /** Google の設定（サービスアカウント）があるか。書き戻しに必要 */
  googleConfigured: boolean;
  /** まだ書いていないマスの数 */
  pendingWrites: number;
  /** 最近シートに書いたもの・書けなかったもの（新しい順） */
  recentWrites: SheetWriteRow[];
  /** 読む元（空なら書き出し先と同じ） */
  spreadsheetId: string | null;
  /** 書き出し先（読む元が空のときに使う） */
  exportSpreadsheetId: string | null;
  roleId: string | null;
  last: SheetSyncRun | null;
  unmatched: Unmatched;
  unmatchedCount: number;
};

function asReport(v: unknown): SyncReport {
  const r = (v ?? {}) as Partial<SyncReport>;
  return { months: Array.isArray(r.months) ? r.months : [], unmatched: { ...EMPTY_UNMATCHED, ...(r.unmatched ?? {}) } };
}

/** シートの自動の読み取りの設定と、最後の結果（ログイン中の人の権限で読む。金額なし） */
export async function getSheetSyncStatus(): Promise<SheetSyncStatus> {
  const supabase = await createClient();
  const [{ data: settings }, { data: last }, { count: pendingWrites }, { data: writes }] = await Promise.all([
    supabase.from("settings").select("key, value").in("key", ["sheet_sync", "sheet_export"]),
    supabase.from("sheet_syncs").select("ran_at, ok, message, report").order("ran_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("sheet_writes").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("sheet_writes").select("processed_at, status, message").neq("status", "pending").order("processed_at", { ascending: false }).limit(60),
  ]);
  const map = new Map((settings ?? []).map((r) => [r.key, (r.value ?? {}) as Record<string, unknown>]));
  const sync = map.get("sheet_sync") ?? {};
  const exp = map.get("sheet_export") ?? {};
  const id = (v: unknown) => (typeof v === "string" && v ? v : null);
  const run: SheetSyncRun | null = last ? { ranAt: last.ran_at, ok: last.ok, message: last.message, report: asReport(last.report) } : null;
  const unmatched = run?.report.unmatched ?? EMPTY_UNMATCHED;
  return {
    enabled: sync.enabled === true,
    writeback: sync.writeback === true,
    addRows: sync.add_rows === true,
    googleConfigured: readServiceAccount() != null,
    pendingWrites: pendingWrites ?? 0,
    recentWrites: collapseWrites(writes ?? []),
    spreadsheetId: id(sync.spreadsheet_id),
    exportSpreadsheetId: id(exp.spreadsheet_id),
    roleId: id(sync.role_id),
    last: run,
    unmatched,
    unmatchedCount: unmatched.clients.length + unmatched.venues.length + unmatched.staff.length + unmatched.places.length,
  };
}

export type SheetAliasRow = { id: string; kind: "client" | "venue" | "staff" | "place"; sheetName: string; targetName: string | null };
export type NameOption = { id: string; name: string };

export type SheetSyncPanelData = { status: SheetSyncStatus; aliases: SheetAliasRow[]; options: { clients: NameOption[]; venues: NameOption[]; staff: NameOption[] }; suggestions: Suggestions };

/**
 * 自動の読み取りの画面に出すもの（設定・最後の結果・覚えた対応づけ・選べる名前の一覧）。
 * 「合わない名前」には CRM の中で近いもの（候補。Phase 20）を付けて、画面で最初から選んでおく（決めるのはオーナー）
 */
export async function getSheetSyncPanelData(): Promise<SheetSyncPanelData> {
  const supabase = await createClient();
  const [status, { data: aliases }, { data: clients }, { data: venues }, { data: staff }] = await Promise.all([
    getSheetSyncStatus(),
    supabase.from("sheet_name_aliases").select("id, kind, sheet_name, target_id").order("created_at", { ascending: false }).limit(200),
    supabase.from("companies").select("id, name").eq("kind", "client").eq("is_active", true).order("name"),
    supabase.from("venues").select("id, name").eq("is_active", true).order("name"),
    supabase.from("staff").select("id, name, kana, line_name").eq("status", "active").order("kana"),
  ]);
  const nameOf = (kind: SheetAliasRow["kind"], id: string | null) => {
    if (!id) return null;
    const list = kind === "staff" ? staff : kind === "venue" ? venues : clients;
    return (list ?? []).find((x) => x.id === id)?.name ?? "（消えたもの）";
  };
  // 下の段にだけある場所（研修など）の候補: その場所に合う会場で、いちばん多く現場をしている取引先
  let events: { client_id: string; venue_id: string }[] = [];
  if (status.unmatched.places.length) {
    const { data } = await supabase.from("events").select("client_id, venue_id").is("cancelled_at", null).order("date", { ascending: false }).limit(2000);
    events = data ?? [];
  }
  const suggestions = status.unmatchedCount ? suggestForUnmatched(status.unmatched, { clients: clients ?? [], venues: venues ?? [], staff: staff ?? [], events }) : EMPTY_SUGGESTIONS;
  return {
    status,
    aliases: (aliases ?? []).map((a) => ({ id: a.id, kind: a.kind as SheetAliasRow["kind"], sheetName: a.sheet_name, targetName: nameOf(a.kind as SheetAliasRow["kind"], a.target_id) })),
    options: { clients: clients ?? [], venues: venues ?? [], staff: (staff ?? []).map((s) => ({ id: s.id, name: s.name })) },
    suggestions,
  };
}

/** 同じ内容（状態と文が同じ）はまとめて1行にする（「書けなかった」が何十件も並ばないように）。新しい順に12行まで */
function collapseWrites(rows: { processed_at: string | null; status: string; message: string }[]): SheetWriteRow[] {
  const out: SheetWriteRow[] = [];
  for (const w of rows) {
    const status = w.status as SheetWriteRow["status"];
    const last = out.find((o) => o.status === status && o.message === w.message);
    if (last) last.count++;
    else out.push({ at: w.processed_at ?? "", status, message: w.message, count: 1 });
  }
  return out.slice(0, 12);
}
