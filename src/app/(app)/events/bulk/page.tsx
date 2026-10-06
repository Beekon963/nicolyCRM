import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth";
import { eventFormOptions } from "@/lib/data/event-form-options";
import { EventForm } from "../event-form";

export const metadata = { title: "まとめて作る | NICOLY CRM" };

export default async function BulkEventsPage() {
  await requireMember();
  const opts = await eventFormOptions();
  return (
    <>
      <PageHeader title="現場をまとめて作る" description="期間と曜日を選ぶと、日ごとの現場をまとめて作ります" back="/events" />
      <EventForm mode="bulk" {...opts} />
    </>
  );
}
