import { notFound } from "next/navigation";
import { ListDetail } from "@/components/app/list-detail";
import { requireMember } from "@/lib/auth";
import { getMasters } from "@/lib/data/masters";
import { getStaffDetail, listStaff } from "@/lib/data/staff";
import { pickParams } from "@/lib/params";
import { StaffList } from "../staff-list";
import { StaffDetail } from "./staff-detail";

export default async function StaffDetailPage({ params, searchParams }: PageProps<"/staff/[id]">) {
  const user = await requireMember();
  const { id } = await params;
  const filters = pickParams(await searchParams, ["q", "role", "rank", "area", "status"]);
  const query = new URLSearchParams(filters).toString();
  const masters = await getMasters();
  const [detail, staff] = await Promise.all([getStaffDetail(id), listStaff(filters, masters)]);
  if (!detail) notFound();

  return (
    <ListDetail
      list={<StaffList staff={staff} masters={masters} query={query} selectedId={id} compact />}
      detail={<StaffDetail detail={detail} masters={masters} user={user} back={`/staff${query ? `?${query}` : ""}`} />}
    />
  );
}

export async function generateMetadata({ params }: PageProps<"/staff/[id]">) {
  const { id } = await params;
  const detail = await getStaffDetail(id);
  return { title: `${detail?.staff.name ?? "スタッフ"} | NICOLY CRM` };
}
