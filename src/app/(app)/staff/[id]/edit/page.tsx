import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth";
import { getMasters } from "@/lib/data/masters";
import { createClient } from "@/lib/supabase/server";
import { StaffForm } from "../../staff-form";
import { memoForEdit } from "@/lib/staff-memo";

export const metadata = { title: "スタッフを編集 | NICOLY CRM" };

export default async function EditStaffPage({ params }: PageProps<"/staff/[id]/edit">) {
  await requireMember();
  const { id } = await params;
  const supabase = await createClient();
  const { data: s } = await supabase.from("staff").select("*, staff_roles(role_id), staff_areas(area_id)").eq("id", id).maybeSingle();
  if (!s) notFound();
  const [masters, { data: others }] = await Promise.all([getMasters(), supabase.from("staff").select("id, name").neq("id", id).order("kana")]);
  // 無効化した役割・エリアでも、付いているものは選択肢に残す
  const keep = <T extends { id: string; is_active: boolean }>(xs: T[], selected: string[]) => xs.filter((x) => x.is_active || selected.includes(x.id));
  const roleIds = s.staff_roles.map((r) => r.role_id);
  const areaIds = s.staff_areas.map((a) => a.area_id);
  return (
    <>
      <PageHeader title="スタッフを編集" description={s.name} back={`/staff/${id}`} />
      <StaffForm
        initial={{
          id: s.id,
          name: s.name,
          kana: s.kana,
          phone: s.phone,
          line_name: s.line_name,
          nearest_station: s.nearest_station,
          rank_id: s.rank_id ?? "",
          status: s.status,
          // 編集しやすいよう1項目1行にして出す（中身は変えない）
          memo: memoForEdit(s.memo),
          role_ids: roleIds,
          area_ids: areaIds,
          referred_by: s.referred_by ?? "",
        }}
        roles={keep(masters.roles, roleIds)}
        ranks={keep(masters.ranks, s.rank_id ? [s.rank_id] : [])}
        areas={keep(masters.areas, areaIds)}
        others={others ?? []}
      />
    </>
  );
}
