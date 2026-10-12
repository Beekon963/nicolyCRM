import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth";
import { parse, todayJst, weekdayJa } from "@/lib/date";
import { dictFor, loadAliases, loadClientItemNames } from "@/lib/data/report-dict";
import { createClient } from "@/lib/supabase/server";
import { ConvertClient } from "./convert-client";

export const metadata = { title: "LINEの報告を変換 | 実績確認 | NICOLY CRM" };

/**
 * LINE に書いた報告（いつもの書き方）を、取引先の公認名称・書式に直す（Phase 8）。
 * 取引先を選ぶと、その取引先の項目・言いかえ表・書式で変換する
 */
export default async function ConvertPage({ searchParams }: PageProps<"/results/convert">) {
  const me = await requireMember();
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: clients }, { data: formats }, aliases] = await Promise.all([
    supabase.from("companies").select("id, name").eq("kind", "client").eq("is_active", true).order("name"),
    supabase.from("report_formats").select("id, name, company_id, header, event_block, person_block, footer").eq("is_active", true).order("sort_order").order("name"),
    loadAliases(),
  ]);
  const list = clients ?? [];
  // 選んでいなければ、専用の書式がある取引先（NextWave など）を先に選んでおく
  const withFormat = list.find((c) => (formats ?? []).some((f) => f.company_id === c.id));
  const clientId = typeof sp.client === "string" && list.some((c) => c.id === sp.client) ? sp.client : (withFormat ?? list[0])?.id;
  const client = list.find((c) => c.id === clientId);
  const itemNames = clientId ? await loadClientItemNames(clientId) : [];
  const today = todayJst();
  const { m, d } = parse(today);

  return (
    <div className="flex flex-col gap-4 pb-8">
      <PageHeader
        title="LINEの報告を変換"
        back="/results/daily"
        description="LINE にいつもの書き方で書いた報告を貼ると、取引先の公認名称と書式に直します。そのまま実績（速報）にも入れられます。"
      />
      <div className="px-4">
        <ConvertClient
          clients={list}
          clientId={clientId ?? ""}
          dict={clientId ? dictFor(clientId, itemNames, aliases) : { items: [], aliases: [] }}
          formats={(formats ?? [])
            // その取引先の書式を先に、全取引先で使う書式（NICOLY用など）をあとに
            .filter((f) => f.company_id === clientId || f.company_id == null)
            .sort((a, b) => Number(a.company_id == null) - Number(b.company_id == null))
            .map((f) => ({ id: f.id, name: f.name, blocks: { header: f.header, eventBlock: f.event_block, personBlock: f.person_block, footer: f.footer } }))}
          defaults={{ date: `${m}/${d}`, weekday: weekdayJa(today), venue: "", workers: [], clientName: client?.name ?? "" }}
          canLearn={me.role === "owner"}
          today={today}
        />
      </div>
    </div>
  );
}
