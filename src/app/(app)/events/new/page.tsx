import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth";
import { eventFormOptions } from "@/lib/data/event-form-options";
import { EventForm } from "../event-form";

export const metadata = { title: "現場を作る | NICOLY CRM" };

export default async function NewEventPage() {
  await requireMember();
  const opts = await eventFormOptions();
  return (
    <>
      <PageHeader title="現場を作る" back="/events" />
      <EventForm mode="single" {...opts} />
    </>
  );
}
