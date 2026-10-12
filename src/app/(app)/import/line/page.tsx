import { PageHeader } from "@/components/app/page-header";
import { requireOwner } from "@/lib/auth";
import { getMasters } from "@/lib/data/masters";
import { loadAliases } from "@/lib/data/report-dict";
import { selectAll } from "@/lib/supabase/select-all";
import { createClient } from "@/lib/supabase/server";
import { LineImport } from "./line-import";

export const metadata = { title: "LINEのトーク履歴 | データ取り込み | NICOLY CRM" };

/** LINE のトーク履歴から、過去の件数の報告と現場詳細を取り込む（Phase 11。オーナーのみ） */
export default async function LineImportPage() {
  await requireOwner();
  const supabase = await createClient();
  const [masters, aliases, staff, venues, clients, events] = await Promise.all([
    getMasters(),
    loadAliases(),
    selectAll((f, t) => supabase.from("staff").select("id, name, kana, line_name").order("kana").range(f, t)),
    selectAll((f, t) => supabase.from("venues").select("id, name").order("name").range(f, t)),
    selectAll((f, t) => supabase.from("companies").select("id, name").eq("kind", "client").order("name").range(f, t)),
    selectAll((f, t) => supabase.from("events").select("venue_id, client_id").order("id").range(f, t)),
  ]);
  // 会場ごとに、いちばん多い取引先（その日に現場がないときに作る現場の取引先の初期値）
  const tally = new Map<string, Map<string, number>>();
  for (const e of events) {
    const m = tally.get(e.venue_id) ?? new Map<string, number>();
    m.set(e.client_id, (m.get(e.client_id) ?? 0) + 1);
    tally.set(e.venue_id, m);
  }
  const venueClient = Object.fromEntries([...tally].map(([v, m]) => [v, [...m].sort((a, b) => b[1] - a[1])[0][0]]));
  return (
    <>
      <PageHeader
        title="LINEのトーク履歴"
        description="件数の報告のトーク履歴から、過去の獲得件数を取り込みます（候補の平均獲得件数・実績の分析に入ります）"
        back="/import"
      />
      <LineImport
        staff={staff}
        venues={venues}
        clients={clients}
        items={masters.items.map((i) => ({ id: i.id, name: i.name, active: i.is_active }))}
        aliases={aliases.filter((a) => a.companyId == null).map((a) => ({ alias: a.alias, name: a.name }))}
        venueClient={venueClient}
      />
    </>
  );
}
