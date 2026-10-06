import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CompanyForm } from "../../company-form";

export const metadata = { title: "会社を編集 | NICOLY CRM" };

export default async function EditCompanyPage({ params }: PageProps<"/sales/[id]/edit">) {
  await requireMember();
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: c }, { data: users }] = await Promise.all([
    supabase.from("companies").select("*").eq("id", id).maybeSingle(),
    supabase.from("app_users").select("id, name").eq("is_active", true).order("name"),
  ]);
  if (!c) notFound();
  return (
    <>
      <PageHeader title={`${c.name} を編集`} back={`/sales/${id}`} />
      <CompanyForm
        users={users ?? []}
        initial={{
          id: c.id,
          kind: c.kind,
          name: c.name,
          kana: c.kana,
          phone: c.phone,
          address: c.address,
          website: c.website,
          status: c.status,
          priority: c.priority,
          owner_user_id: c.owner_user_id ?? "",
          next_action_date: c.next_action_date ?? "",
          next_action: c.next_action,
          memo: c.memo,
          is_active: c.is_active,
        }}
      />
    </>
  );
}
