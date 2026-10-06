import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth";
import { getMasters } from "@/lib/data/masters";
import { createClient } from "@/lib/supabase/server";
import { StaffForm } from "../staff-form";

export const metadata = { title: "スタッフを登録 | NICOLY CRM" };

export default async function NewStaffPage() {
  const user = await requireMember();
  const masters = await getMasters();
  let rankRates: Record<string, number> | undefined;
  if (user.role === "owner") {
    const supabase = await createClient();
    const { data } = await supabase.from("rank_rates").select("rank_id, base_daily_rate");
    rankRates = Object.fromEntries((data ?? []).map((r) => [r.rank_id, r.base_daily_rate]));
  }
  const active = <T extends { is_active: boolean }>(xs: T[]) => xs.filter((x) => x.is_active);
  return (
    <>
      <PageHeader title="スタッフを登録" back="/staff" />
      <StaffForm roles={active(masters.roles)} ranks={active(masters.ranks)} areas={active(masters.areas)} rankRates={rankRates} />
    </>
  );
}
