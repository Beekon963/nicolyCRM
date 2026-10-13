import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth";
import { getAcademyLinks } from "@/lib/data/academy";
import { selectAll } from "@/lib/supabase/select-all";
import { createClient } from "@/lib/supabase/server";
import { AcademyImport } from "./academy-import";

export const metadata = { title: "アカデミーの進み具合 | スタッフ | NICOLY CRM" };

/** NICOLY アカデミーの進み具合を取り込む（Phase 14。オーナー・管理者。お金の情報はない） */
export default async function AcademyImportPage() {
  await requireMember();
  const supabase = await createClient();
  const [staff, links] = await Promise.all([
    selectAll((f, t) => supabase.from("staff").select("id, name, kana, line_name, status").order("kana").order("id").range(f, t)),
    getAcademyLinks(),
  ]);
  return (
    <>
      <PageHeader title="アカデミーの進み具合" description="NICOLY アカデミーの称号・分野の進み具合・テスト・稼働判断を取り込みます" back="/staff" />
      <AcademyImport staff={staff} links={links} />
    </>
  );
}
