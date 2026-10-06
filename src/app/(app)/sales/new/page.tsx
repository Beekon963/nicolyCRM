import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CompanyForm } from "../company-form";

export const metadata = { title: "会社を登録 | NICOLY CRM" };

export default async function NewCompanyPage({ searchParams }: PageProps<"/sales/new">) {
  const user = await requireMember();
  const kind = (await searchParams).kind === "partner" ? "partner" : "client";
  const supabase = await createClient();
  const { data: users } = await supabase.from("app_users").select("id, name").eq("is_active", true).order("name");
  return (
    <>
      <PageHeader title={kind === "client" ? "取引先を登録" : "協力会社を登録"} back={`/sales?kind=${kind}`} />
      <CompanyForm
        users={users ?? []}
        initial={{
          kind,
          name: "",
          kana: "",
          phone: "",
          address: "",
          website: "",
          // 取引先はすでに取引があるので「取引中」から
          status: kind === "client" ? "active" : "not_contacted",
          priority: "mid",
          owner_user_id: user.id,
          next_action_date: "",
          next_action: "",
          memo: "",
          is_active: true,
        }}
      />
    </>
  );
}
