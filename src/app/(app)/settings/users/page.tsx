import { PageHeader } from "@/components/app/page-header";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { UsersClient } from "./users-client";

export const metadata = { title: "ユーザー | 設定 | NICOLY CRM" };

export default async function UsersPage() {
  const me = await requireOwner();
  const supabase = await createClient();
  const { data: users } = await supabase
    .from("app_users")
    .select("id, name, email, role, is_active")
    .order("is_active", { ascending: false })
    .order("role")
    .order("name");

  return (
    <>
      <PageHeader
        title="ユーザー"
        back="/settings"
        description="招待した人だけがログインできます。無効にするとすぐにログインできなくなります。"
      />
      <UsersClient users={users ?? []} meId={me.id} />
    </>
  );
}
