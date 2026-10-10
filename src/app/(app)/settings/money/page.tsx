import { PageHeader } from "@/components/app/page-header";
import { requireOwner } from "@/lib/auth";
import { getMasters } from "@/lib/data/masters";
import { getIncentiveRates, getMoneySettings } from "@/lib/data/money";
import { MoneySettingsForm } from "./money-settings-form";

export const metadata = { title: "お金の設定 | 設定 | NICOLY CRM" };

export default async function MoneySettingsPage() {
  await requireOwner();
  const [settings, incentives, masters] = await Promise.all([getMoneySettings(), getIncentiveRates(), getMasters()]);
  return (
    <>
      <PageHeader title="お金の設定" description="インセンティブ単価・消費税・源泉徴収・支払日" back="/settings" />
      <MoneySettingsForm
        settings={settings}
        incentives={masters.items.filter((i) => i.is_active || incentives.has(i.id)).map((i) => ({ id: i.id, name: i.name, amount: incentives.get(i.id) ?? null }))}
      />
    </>
  );
}
