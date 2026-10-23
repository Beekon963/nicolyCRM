import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requireMember } from "@/lib/auth";
import { listJobs } from "@/lib/data/jobs";
import { JobsView } from "./jobs-view";

export const metadata = { title: "案件 | NICOLY CRM" };

/** 案件の一覧（カード）とカンバン（Phase 21） */
export default async function JobsPage({ searchParams }: PageProps<"/jobs">) {
  await requireMember();
  const sp = await searchParams;
  const view = sp.view === "kanban" ? "kanban" : "list";
  const includeClosed = sp.closed === "1";
  const jobs = await listJobs({ includeClosed });
  return (
    <>
      <PageHeader
        title="案件"
        description="取引先から来た案件ごとに、だれがどの段階か（スキルシート → 面談 → 合否 → 現場詳細）を見る"
        actions={
          <Button asChild>
            <Link href="/jobs/new">案件を作る（文を貼る）</Link>
          </Button>
        }
      />
      <JobsView jobs={jobs} view={view} includeClosed={includeClosed} now={new Date().toISOString()} />
    </>
  );
}
