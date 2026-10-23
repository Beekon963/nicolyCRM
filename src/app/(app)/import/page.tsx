import { PageHeader } from "@/components/app/page-header";
import { requireOwner } from "@/lib/auth";
import { getMasters } from "@/lib/data/masters";
import { getSheetSyncPanelData } from "@/lib/data/sheet-sync";
import { createClient } from "@/lib/supabase/server";
import { ImportWizard } from "./import-wizard";
import { SheetSyncPanel } from "./sheet-sync-panel";

export const metadata = { title: "データ取り込み | NICOLY CRM" };

/** CSV 取り込み（オーナーのみ。日当などの金額項目を含むため。要件 §4.13） */
export default async function ImportPage() {
  await requireOwner();
  const supabase = await createClient();
  const [masters, { data: target }, sync] = await Promise.all([getMasters(), supabase.from("settings").select("value").eq("key", "sheet_export").maybeSingle(), getSheetSyncPanelData()]);
  // シートへの書き出し先（いつもの管理用シート）を、直接読むときの最初の URL にする
  const sheetId = (target?.value as { spreadsheet_id?: string } | null)?.spreadsheet_id;
  const roles = masters.roles.filter((r) => r.is_active).map((r) => ({ id: r.id, name: r.name }));
  return (
    <>
      <PageHeader title="データ取り込み" description="スタッフ名簿・取引先・協力会社・会場・月の稼働表を CSV でまとめて登録します" />
      {/* シートを自動で読む（Phase 18）。月の稼働表を手で取り込まなくてよい */}
      <div className="px-4 pb-4">
        <SheetSyncPanel status={sync.status} aliases={sync.aliases} options={sync.options} suggestions={sync.suggestions} roles={roles} />
      </div>
      <ImportWizard roles={roles} defaultSheetUrl={sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}/edit` : ""} />
    </>
  );
}
