import { PageHeader } from "@/components/app/page-header";
import { requireOwner } from "@/lib/auth";
import { getMasters } from "@/lib/data/masters";
import { ImportWizard } from "./import-wizard";

export const metadata = { title: "データ取り込み | NICOLY CRM" };

/** CSV 取り込み（オーナーのみ。日当などの金額項目を含むため。要件 §4.13） */
export default async function ImportPage() {
  await requireOwner();
  const masters = await getMasters();
  const roles = masters.roles.filter((r) => r.is_active).map((r) => ({ id: r.id, name: r.name }));
  return (
    <>
      <PageHeader title="データ取り込み" description="スタッフ名簿・取引先・協力会社・会場・月の稼働表を CSV でまとめて登録します" />
      <ImportWizard roles={roles} />
    </>
  );
}
