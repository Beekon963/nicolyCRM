import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isMasterKind, MASTER_KINDS, type MasterRow } from "../kinds";
import { MasterEditor } from "./master-editor";

export default async function MasterPage({ params }: PageProps<"/settings/masters/[kind]">) {
  await requireOwner();
  const { kind } = await params;
  if (!isMasterKind(kind)) notFound();
  const supabase = await createClient();

  let rows: MasterRow[];
  if (kind === "ranks") {
    const [{ data: ranks }, { data: rates }] = await Promise.all([
      supabase.from("ranks").select("id, name, description, is_active").order("sort_order"),
      supabase.from("rank_rates").select("rank_id, base_daily_rate"),
    ]);
    const rateMap = new Map((rates ?? []).map((r) => [r.rank_id, r.base_daily_rate]));
    rows = (ranks ?? []).map((r) => ({ ...r, base_daily_rate: rateMap.get(r.id) ?? null }));
  } else {
    const { data } = await supabase.from(kind).select("id, name, is_active").order("sort_order");
    rows = data ?? [];
  }

  return (
    <>
      <PageHeader title={MASTER_KINDS[kind].title} back="/settings" description={MASTER_KINDS[kind].description} />
      <MasterEditor kind={kind} initial={rows} />
    </>
  );
}

export async function generateMetadata({ params }: PageProps<"/settings/masters/[kind]">) {
  const { kind } = await params;
  return { title: `${isMasterKind(kind) ? MASTER_KINDS[kind].title : "設定"} | 設定 | NICOLY CRM` };
}
