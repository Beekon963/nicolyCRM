import { ListDetail } from "@/components/app/list-detail";
import { requireMember } from "@/lib/auth";
import { todayJst } from "@/lib/date";
import { listCompanies } from "@/lib/data/companies";
import { pickParams } from "@/lib/params";
import { CompanyList } from "./company-list";

export const metadata = { title: "営業 | NICOLY CRM" };

export default async function SalesPage({ searchParams }: PageProps<"/sales">) {
  await requireMember();
  const params = pickParams(await searchParams, ["kind", "q", "status", "inactive"]);
  const kind = params.kind === "partner" ? "partner" : "client";
  const companies = await listCompanies(params);
  return (
    <ListDetail
      list={<CompanyList companies={companies} kind={kind} query={new URLSearchParams(params).toString()} today={todayJst()} />}
    />
  );
}
