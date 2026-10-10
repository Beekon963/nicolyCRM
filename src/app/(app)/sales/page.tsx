import { ListDetail } from "@/components/app/list-detail";
import { requireMember } from "@/lib/auth";
import { todayJst } from "@/lib/date";
import { COMPANY_FILTER_KEYS, listActiveUsers, listCompanies } from "@/lib/data/companies";
import { pickParams } from "@/lib/params";
import { CompanyList } from "./company-list";

export const metadata = { title: "営業 | NICOLY CRM" };

export default async function SalesPage({ searchParams }: PageProps<"/sales">) {
  const user = await requireMember();
  const params = pickParams(await searchParams, COMPANY_FILTER_KEYS);
  const kind = params.kind === "partner" ? "partner" : "client";
  const [companies, users] = await Promise.all([listCompanies(params, user.id), listActiveUsers()]);
  return (
    <ListDetail
      list={
        <CompanyList
          companies={companies}
          kind={kind}
          users={users}
          view={params.view === "kanban" ? "kanban" : "list"}
          query={new URLSearchParams(params).toString()}
          today={todayJst()}
        />
      }
    />
  );
}
