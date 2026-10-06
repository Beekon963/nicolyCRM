import { ListDetail } from "@/components/app/list-detail";
import { requireMember } from "@/lib/auth";
import { getMasters } from "@/lib/data/masters";
import { listStaff } from "@/lib/data/staff";
import { pickParams } from "@/lib/params";
import { StaffList } from "./staff-list";

export const metadata = { title: "スタッフ | NICOLY CRM" };

export default async function StaffPage({ searchParams }: PageProps<"/staff">) {
  await requireMember();
  const params = pickParams(await searchParams, ["q", "role", "rank", "area", "status"]);
  const masters = await getMasters();
  const staff = await listStaff(params, masters);
  return <ListDetail list={<StaffList staff={staff} masters={masters} query={new URLSearchParams(params).toString()} />} />;
}
