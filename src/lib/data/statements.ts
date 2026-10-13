import "server-only";
import { getMasters } from "@/lib/data/masters";
import { getMoneySettings, getMonthMoney, type MoneySettings } from "@/lib/data/money";
import { buildStatement, type Statement } from "@/lib/money";
import { getGeneralSettings, type GeneralSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

/**
 * ★ 支払明細書（Phase 13。オーナーだけ）。お金 → 支払い と同じ数字から作る。
 * 締めた月は締めた時点の数字、締めていない月はいまのデータで計算した「仮」の数字。
 * 並びはいただいた一覧と同じく、ランクの高い順 → かな順
 */
export type StatementsData = {
  month: string;
  closed: boolean;
  statements: Statement[];
  settings: MoneySettings;
  company: GeneralSettings["companyProfile"];
};

export async function getStatements(month: string): Promise<StatementsData> {
  const [money, settings, masters, general] = await Promise.all([getMonthMoney(month), getMoneySettings(), getMasters(), getGeneralSettings()]);
  const supabase = await createClient();
  const ids = money.staff.map((s) => s.id);
  const { data: staff } = ids.length ? await supabase.from("staff").select("id, kana, rank_id").in("id", ids) : { data: [] };
  const info = new Map((staff ?? []).map((s) => [s.id, s]));
  const rankOrder = new Map(masters.ranks.map((r, i) => [r.id, i]));
  const itemName = (id: string) => masters.itemById.get(id)?.name ?? "（獲得項目）";

  const statements = money.staff
    .map((s) => {
      const rankId = info.get(s.id)?.rank_id ?? null;
      return buildStatement(s, { rankName: rankId ? (masters.rankById.get(rankId)?.name ?? null) : null, itemName, taxRatePercent: settings.taxRatePercent });
    })
    .filter((st) => st.total !== 0 || st.worked > 0)
    .sort((a, b) => {
      const ra = rankOrder.get(info.get(a.staffId)?.rank_id ?? "") ?? 999;
      const rb = rankOrder.get(info.get(b.staffId)?.rank_id ?? "") ?? 999;
      return ra - rb || (info.get(a.staffId)?.kana || a.name).localeCompare(info.get(b.staffId)?.kana || b.name, "ja");
    });
  return { month, closed: money.closing === "closed", statements, settings, company: general.companyProfile };
}
