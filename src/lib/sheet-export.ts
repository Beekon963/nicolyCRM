import "server-only";
import { boardFromSnapshot, type BoardSnapshot } from "@/lib/board/snapshot";
import { boardToSheetValues, sheetTitle } from "@/lib/board/sheet";
import { formatTimeJst, monthOf, monthRange, nextMonth, parse, todayJst } from "@/lib/date";
import { holidaysBetween } from "@/lib/date/holidays";
import { getAccessToken, readServiceAccount, SheetError, SheetsClient } from "@/lib/google/sheets";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 稼働表をスプレッドシートへ書き出す（Phase 1.5）。今月と来月の2つのタブ（202610 など）を入れ替える。
 * 自動実行（ログインなし）からも動くので秘密キーで DB に接続するが、読むのは board_snapshot()
 * （見るだけリンクと同じ、金額・電話番号のない内容）と書き出し先の設定だけ。結果は sheet_exports に残す。
 */
export async function runSheetExport(source: "cron" | "button"): Promise<{ ok: boolean; message: string }> {
  const admin = createAdminClient();
  const log = async (ok: boolean, message: string) => {
    await admin.from("sheet_exports").insert({ ok, message, source });
    return { ok, message };
  };

  const { data: setting } = await admin.from("settings").select("value").eq("key", "sheet_export").maybeSingle();
  const spreadsheetId = (setting?.value as { spreadsheet_id?: string } | null)?.spreadsheet_id;
  // 書き出し先が未設定なら、自動実行では何もしない
  if (!spreadsheetId) return source === "cron" ? { ok: false, message: "書き出し先が未設定です" } : log(false, "書き出し先のスプレッドシートが未設定です");
  const sa = readServiceAccount();
  if (!sa) return log(false, "Google のサービスアカウントが未設定です（docs/setup.md の「シートへの自動書き出し」）");

  try {
    const client = new SheetsClient(await getAccessToken(sa), spreadsheetId, sa.client_email);
    const titles = await client.sheetTitles();
    const now = new Date();
    const today = todayJst(now);
    const { m, d } = parse(today);
    const updatedAt = `${m}/${d} ${formatTimeJst(now)}`;
    const months = [monthOf(today), nextMonth(monthOf(today))];
    for (const month of months) {
      const { data, error } = await admin.rpc("board_snapshot", { p_month: `${month}-01` });
      if (error || !data) throw new SheetError("稼働表を読めませんでした");
      const { start, end } = monthRange(month);
      const board = boardFromSnapshot(data as unknown as BoardSnapshot, month, today, holidaysBetween(start, end));
      const title = sheetTitle(month);
      if (!titles.includes(title)) await client.addSheet(title);
      await client.replaceValues(title, boardToSheetValues(board, updatedAt));
    }
    return log(true, `${months.map(sheetTitle).join("・")} を書き出しました`);
  } catch (e) {
    return log(false, e instanceof SheetError ? e.message : "書き出しに失敗しました。時間をおいてもう一度試してください");
  }
}
