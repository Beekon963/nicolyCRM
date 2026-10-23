import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth";
import { eventFormOptions } from "@/lib/data/event-form-options";
import { todayJst } from "@/lib/date";
import { NewJobClient } from "./new-job-client";

export const metadata = { title: "案件を作る | NICOLY CRM" };

/** 取引先からの案件の文（日付・会場・人数の一覧）を貼って、案件と現場をまとめて作る（Phase 21） */
export default async function NewJobPage({ searchParams }: PageProps<"/jobs/new">) {
  const me = await requireMember();
  const [opts, sp] = await Promise.all([eventFormOptions(), searchParams]);
  const initialText = typeof sp.text === "string" ? sp.text.slice(0, 20_000) : "";
  return (
    <>
      <PageHeader title="案件を作る" description="取引先の LINE の文を貼ると、日付・会場・人数・稼働時間・備考を読み取ります" back="/jobs" />
      <NewJobClient clients={opts.clients} venues={opts.venues} roles={opts.roles} today={todayJst()} initialText={initialText} isOwner={me.role === "owner"} />
    </>
  );
}
