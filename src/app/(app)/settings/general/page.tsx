import { PageHeader } from "@/components/app/page-header";
import { requireOwner } from "@/lib/auth";
import { getGeneralSettings } from "@/lib/settings";
import { GeneralForm } from "./general-form";

export const metadata = { title: "締切・会社情報 | 設定 | NICOLY CRM" };

export default async function GeneralSettingsPage() {
  await requireOwner();
  return (
    <>
      <PageHeader title="締切・会社情報" back="/settings" />
      <GeneralForm initial={await getGeneralSettings()} />
    </>
  );
}
