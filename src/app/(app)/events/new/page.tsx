import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth";
import { isDateString } from "@/lib/date";
import { eventFormOptions } from "@/lib/data/event-form-options";
import { EventForm } from "../event-form";

export const metadata = { title: "現場を作る | NICOLY CRM" };

export default async function NewEventPage({ searchParams }: PageProps<"/events/new">) {
  await requireMember();
  const [opts, sp] = await Promise.all([eventFormOptions(), searchParams]);
  const date = typeof sp.date === "string" && isDateString(sp.date) ? sp.date : undefined;
  const client = typeof sp.client === "string" && opts.clients.some((c) => c.id === sp.client) ? sp.client : undefined;
  return (
    <>
      <PageHeader title="現場を作る" back="/events" />
      <EventForm mode="single" defaults={{ date, client_id: client }} {...opts} />
    </>
  );
}
