import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth";
import { getJob } from "@/lib/data/jobs";
import { getMasters } from "@/lib/data/masters";
import { createClient } from "@/lib/supabase/server";
import { JobDetail } from "./job-detail";

export const metadata = { title: "案件 | NICOLY CRM" };

/** 案件の画面: 日程の表・候補の段階・LINE に貼る文（Phase 21） */
export default async function JobPage({ params }: PageProps<"/jobs/[id]">) {
  const me = await requireMember();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const [job, masters, { data: staff }] = await Promise.all([getJob(id), getMasters(), supabase.from("staff").select("id, name, kana").eq("status", "active").order("kana")]);
  if (!job) notFound();
  return (
    <>
      <PageHeader title={job.name} description={job.clientName} back="/jobs" />
      <JobDetail job={job} staff={staff ?? []} roles={masters.roles.filter((r) => r.is_active).map((r) => ({ id: r.id, name: r.name }))} isOwner={me.role === "owner"} now={new Date().toISOString()} />
    </>
  );
}
