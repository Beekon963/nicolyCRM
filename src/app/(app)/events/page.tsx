import { ListDetail } from "@/components/app/list-detail";
import { requireMember } from "@/lib/auth";
import { pickParams } from "@/lib/params";
import { EventList } from "./event-list";
import { EVENT_FILTER_KEYS, loadEventList } from "./load";

export const metadata = { title: "現場 | NICOLY CRM" };

export default async function EventsPage({ searchParams }: PageProps<"/events">) {
  await requireMember();
  const filters = pickParams(await searchParams, EVENT_FILTER_KEYS);
  const data = await loadEventList(filters);
  return <ListDetail list={<EventList {...data} filters={filters} />} />;
}
