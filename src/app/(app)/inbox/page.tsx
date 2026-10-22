import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { InboxClient } from "./inbox-client";

export const metadata = { title: "LINE から入れる | NICOLY CRM" };

/**
 * 「LINE の文を貼るだけ」（Phase 18）。件数の報告・稼働可能日・募集の文・案件詳細・打診の返事を見分けて、
 * 確認カードを出す。登録は「登録する」を押したときだけ。
 */
export default async function InboxPage() {
  await requireMember();
  const supabase = await createClient();
  const [{ data: staff }, { data: venues }, { data: inbox }] = await Promise.all([
    supabase.from("staff").select("id, name").eq("status", "active").order("kana"),
    supabase.from("venues").select("id, name").eq("is_active", true).order("name"),
    supabase.from("line_inbox").select("id, text, created_at").is("done_at", null).order("created_at", { ascending: false }).limit(20),
  ]);
  return (
    <>
      <PageHeader title="LINE から入れる" description="LINE に来た文を貼るだけで、件数・稼働可能日・現場・案件詳細が入ります" />
      <div className="px-4 pb-6">
        <InboxClient staff={staff ?? []} venues={venues ?? []} inbox={(inbox ?? []).map((i) => ({ id: i.id, text: i.text, createdAt: i.created_at }))} />
      </div>
    </>
  );
}
