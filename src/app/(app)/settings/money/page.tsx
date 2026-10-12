import { PageHeader } from "@/components/app/page-header";
import { requireOwner } from "@/lib/auth";
import { getMasters } from "@/lib/data/masters";
import { getExportSettings, getIncentiveRates, getMoneySettings } from "@/lib/data/money";
import { ExportSettingsForm } from "./export-settings-form";
import { MoneySettingsForm } from "./money-settings-form";
import { RankRulesForm } from "./rank-rules-form";

export const metadata = { title: "お金の設定 | 設定 | NICOLY CRM" };

export default async function MoneySettingsPage() {
  await requireOwner();
  const [settings, incentives, masters, exportSettings] = await Promise.all([getMoneySettings(), getIncentiveRates(), getMasters(), getExportSettings()]);
  return (
    <>
      <PageHeader title="お金の設定" description="インセンティブ単価・消費税・源泉徴収・支払日・遠方の上乗せ・友達紹介・freee・振込データ" back="/settings" />
      <MoneySettingsForm
        settings={settings}
        incentives={masters.items.filter((i) => i.is_active || incentives.has(i.id)).map((i) => ({ id: i.id, name: i.name, amount: incentives.get(i.id) ?? null }))}
      />
      <RankRulesForm travelStepAmount={settings.travelStepAmount} referral={settings.referralBonus} />
      <ExportSettingsForm freee={exportSettings.freee} zengin={exportSettings.zengin} />
    </>
  );
}
