import { PageHeader } from "@/components/app/page-header";
import { requireOwner } from "@/lib/auth";
import { TEMPLATE_KIND } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { TemplateEditor } from "./template-editor";

export const metadata = { title: "文面テンプレート | 設定 | NICOLY CRM" };

export default async function TemplatesPage() {
  await requireOwner();
  const supabase = await createClient();
  const { data } = await supabase.from("message_templates").select("kind, body");
  const bodies = new Map((data ?? []).map((t) => [t.kind, t.body]));

  return (
    <>
      <PageHeader
        title="文面テンプレート"
        back="/settings"
        description="{名前} などの差し込み項目は、送るときに自動で置き換わります。下のボタンで差し込めます。"
      />
      <div className="flex flex-col gap-4 px-4">
        {(Object.keys(TEMPLATE_KIND) as (keyof typeof TEMPLATE_KIND)[]).map((kind) => (
          <TemplateEditor key={kind} kind={kind} initial={bodies.get(kind) ?? ""} />
        ))}
      </div>
    </>
  );
}
