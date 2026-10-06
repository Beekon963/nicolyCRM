import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth";
import { eventFormOptions } from "@/lib/data/event-form-options";
import { createClient } from "@/lib/supabase/server";
import { EventForm } from "../../event-form";

export const metadata = { title: "現場を編集 | NICOLY CRM" };

export default async function EditEventPage({ params }: PageProps<"/events/[id]/edit">) {
  await requireMember();
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: ev }, { data: reqs }] = await Promise.all([
    supabase.from("events").select("*").eq("id", id).maybeSingle(),
    supabase.from("event_requirements").select("role_id, required_count").eq("event_id", id),
  ]);
  if (!ev) notFound();
  const opts = await eventFormOptions(ev);
  const t = (v: string | null) => (v ? v.slice(0, 5) : "");
  return (
    <>
      <PageHeader title="現場を編集" back={`/events/${id}`} />
      <EventForm
        mode="edit"
        {...opts}
        initial={{
          id,
          date: ev.date,
          client_id: ev.client_id,
          venue_id: ev.venue_id,
          start_time: t(ev.start_time),
          end_time: t(ev.end_time),
          meeting_time: t(ev.meeting_time),
          meeting_place: ev.meeting_place,
          belongings: ev.belongings,
          notes: ev.notes,
          requirements: opts.roles.map((r) => ({ role_id: r.id, required_count: reqs?.find((x) => x.role_id === r.id)?.required_count ?? 0 })),
        }}
      />
    </>
  );
}
