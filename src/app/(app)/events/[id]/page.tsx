import { notFound } from "next/navigation";
import { ListDetail } from "@/components/app/list-detail";
import { requireMember } from "@/lib/auth";
import { getEventDetail } from "@/lib/data/events";
import { getMasters } from "@/lib/data/masters";
import { pickParams } from "@/lib/params";
import { EventList } from "../event-list";
import { EVENT_FILTER_KEYS, loadEventList } from "../load";
import { EventDetailView } from "./event-detail";

export default async function EventDetailPage({ params, searchParams }: PageProps<"/events/[id]">) {
  await requireMember();
  const { id } = await params;
  const filters = pickParams(await searchParams, EVENT_FILTER_KEYS);
  const listFilters = filters.view === "calendar" ? { ...filters, view: undefined } : filters;
  const [detail, masters, list] = await Promise.all([getEventDetail(id), getMasters(), loadEventList(listFilters)]);
  if (!detail) notFound();
  const query = new URLSearchParams(filters as Record<string, string>).toString();
  return (
    <ListDetail
      list={<EventList {...list} filters={listFilters} selectedId={id} />}
      detail={<EventDetailView detail={detail} masters={masters} back={`/events${query ? `?${query}` : ""}`} />}
    />
  );
}

export async function generateMetadata({ params }: PageProps<"/events/[id]">) {
  const { id } = await params;
  const d = await getEventDetail(id);
  return { title: d ? `${d.event.date} ${d.venue.name} | NICOLY CRM` : "現場 | NICOLY CRM" };
}
