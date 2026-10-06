import { ExternalLinkIcon, PencilIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Field, ListDetail, Section } from "@/components/app/list-detail";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireMember } from "@/lib/auth";
import { formatShortJa } from "@/lib/date";
import { getMasters } from "@/lib/data/masters";
import { getVenueDetail, listVenues, mapUrl } from "@/lib/data/venues";
import { pickParams } from "@/lib/params";
import { VenueList } from "../venue-list";

export default async function VenueDetailPage({ params, searchParams }: PageProps<"/venues/[id]">) {
  await requireMember();
  const { id } = await params;
  const filters = pickParams(await searchParams, ["q", "area", "inactive"]);
  const query = new URLSearchParams(filters).toString();
  const [masters, venues, detail] = await Promise.all([getMasters(), listVenues(filters), getVenueDetail(id)]);
  if (!detail) notFound();
  const { venue, events, mainClients } = detail;

  return (
    <ListDetail
      list={<VenueList venues={venues} masters={masters} query={query} selectedId={id} />}
      detail={
        <div className="pb-8">
          <PageHeader
            back={`/venues${query ? `?${query}` : ""}`}
            title={venue.name}
            description={masters.areaById.get(venue.area_id ?? "")?.name}
            actions={
              <Button asChild variant="outline" size="sm">
                <Link href={`/venues/${id}/edit`}>
                  <PencilIcon />
                  編集
                </Link>
              </Button>
            }
          />
          <Section title="会場情報">
            <dl>
              <Field label="住所">
                {venue.address && (
                  <a href={mapUrl(venue)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary">
                    {venue.address}
                    <ExternalLinkIcon className="size-4" />
                  </a>
                )}
              </Field>
              <Field label="最寄り駅">{venue.nearest_station}</Field>
              <Field label="入館方法">{venue.access_notes && <span className="whitespace-pre-wrap">{venue.access_notes}</span>}</Field>
              <Field label="控室">{venue.green_room}</Field>
              <Field label="駐車場">{venue.parking}</Field>
              <Field label="主な取引先">{mainClients.map((c) => `${c.name}（${c.count}回）`).join("、")}</Field>
              <Field label="メモ">{venue.memo && <span className="whitespace-pre-wrap">{venue.memo}</span>}</Field>
            </dl>
          </Section>
          <Section title={`過去の現場と獲得実績（${events.length}件）`}>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">まだ現場はありません</p>
            ) : (
              <ul className="divide-y">
                {events.map((e) => (
                  <li key={e.id}>
                    <Link href={`/events/${e.id}`} className="flex items-center gap-3 py-2 hover:bg-accent">
                      <span className="w-20 shrink-0 text-sm font-medium">{formatShortJa(e.date)}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {e.client?.name}
                        <span className="block text-sm text-muted-foreground">稼働 {e.worked}人</span>
                      </span>
                      {e.cancelled ? (
                        <Badge tone="muted">中止</Badge>
                      ) : (
                        <span className="text-right text-sm">
                          <span className="block">確定 {e.confirmed ?? "−"}件</span>
                          <span className="block text-muted-foreground">速報 {e.reported ?? "−"}件</span>
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      }
    />
  );
}
