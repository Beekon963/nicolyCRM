import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth";
import { todayJst } from "@/lib/date";
import { eventFormOptions } from "@/lib/data/event-form-options";
import { FromTextClient } from "./from-text-client";

export const metadata = { title: "募集の文から現場を作る | NICOLY CRM" };

/** 取引先の募集の文（LINE）を貼って、現場をまとめて作る（Phase 9） */
export default async function EventsFromTextPage({ searchParams }: PageProps<"/events/from-text">) {
  await requireMember();
  const [opts, sp] = await Promise.all([eventFormOptions(), searchParams]);
  // 「LINE の文を貼るだけ」から来たとき、貼った文を最初から入れておく（Phase 18）
  const initialText = typeof sp.text === "string" ? sp.text.slice(0, 20_000) : "";
  return (
    <>
      <PageHeader title="募集の文から現場を作る" description="取引先の LINE の募集の文を貼ると、日付・会場・時間・人数を読み取ります" back="/events" />
      <FromTextClient {...opts} today={todayJst()} initialText={initialText} />
    </>
  );
}
