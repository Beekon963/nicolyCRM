import { ListDetail } from "@/components/app/list-detail";
import { requireMember } from "@/lib/auth";
import { getMasters } from "@/lib/data/masters";
import { listVenues } from "@/lib/data/venues";
import { pickParams } from "@/lib/params";
import { VenueList } from "./venue-list";

export const metadata = { title: "会場 | NICOLY CRM" };

export default async function VenuesPage({ searchParams }: PageProps<"/venues">) {
  await requireMember();
  const params = pickParams(await searchParams, ["q", "area", "inactive"]);
  const [masters, venues] = await Promise.all([getMasters(), listVenues(params)]);
  return <ListDetail list={<VenueList venues={venues} masters={masters} query={new URLSearchParams(params).toString()} />} />;
}
