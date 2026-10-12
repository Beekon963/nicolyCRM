import { PageHeader } from "@/components/app/page-header";
import { requireOwner } from "@/lib/auth";
import { getMasters } from "@/lib/data/masters";
import { loadAliases } from "@/lib/data/report-dict";
import { createClient } from "@/lib/supabase/server";
import { AliasEditor } from "./alias-editor";
import { ReportFormatList } from "./report-format-list";

export const metadata = { title: "日報のフォーマット | 設定 | NICOLY CRM" };

/** ★ 日報のフォーマット（取引先ごとの LINE 用の書式）。オーナーだけが作る・直す */
export default async function ReportFormatsPage() {
  await requireOwner();
  const supabase = await createClient();
  const [formats, clients, masters, aliases] = await Promise.all([
    supabase.from("report_formats").select("id, name, company_id, for_staff, is_active, header, event_block, person_block, footer, start_block").order("sort_order").order("created_at"),
    supabase.from("companies").select("id, name").eq("kind", "client").eq("is_active", true).order("name"),
    getMasters(),
    loadAliases(),
  ]);
  return (
    <>
      <PageHeader
        title="日報のフォーマット"
        back="/settings"
        description="集めた実績報告を、取引先ごとの書式の文章にして LINE にコピーできます（実績確認 → 日報）。スタッフのマイページにも出せます。"
      />
      <ReportFormatList
        formats={(formats.data ?? []).map((f) => ({
          id: f.id,
          name: f.name,
          companyId: f.company_id,
          forStaff: f.for_staff,
          isActive: f.is_active,
          header: f.header,
          eventBlock: f.event_block,
          personBlock: f.person_block,
          footer: f.footer,
          startBlock: f.start_block,
        }))}
        clients={clients.data ?? []}
        itemNames={masters.items.filter((i) => i.is_active).map((i) => i.name)}
      />
      <AliasEditor aliases={aliases} clients={clients.data ?? []} itemNames={masters.items.filter((i) => i.is_active).map((i) => i.name)} />
    </>
  );
}
