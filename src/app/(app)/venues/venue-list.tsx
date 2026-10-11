import Link from "next/link";
import { Suspense } from "react";
import { FilterBar } from "@/components/app/filter-bar";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { VenueColorDot } from "@/components/app/venue-color";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Masters } from "@/lib/data/masters";
import type { listVenues } from "@/lib/data/venues";
import { cn } from "@/lib/utils";

export function VenueList({
  venues,
  masters,
  query,
  selectedId,
}: {
  venues: Awaited<ReturnType<typeof listVenues>>;
  masters: Masters;
  query: string;
  selectedId?: string;
}) {
  return (
    <>
      <PageHeader
        title="会場"
        description={`${venues.length}か所`}
        actions={
          <Button asChild size="sm">
            <Link href="/venues/new">＋ 登録</Link>
          </Button>
        }
      />
      <Suspense>
        <FilterBar
          basePath="/venues"
          searchPlaceholder="会場名・住所・駅"
          filters={[
            { name: "area", label: "エリア", options: masters.areas.filter((a) => a.is_active).map((a) => ({ value: a.id, label: a.name })) },
            { name: "inactive", label: "表示", allLabel: "使用中のみ", options: [{ value: "1", label: "使っていない会場も" }] },
          ]}
        />
      </Suspense>
      {venues.length === 0 ? (
        <EmptyState title="該当する会場がありません" action={<Button asChild><Link href="/venues/new">会場を登録する</Link></Button>} />
      ) : (
        // PC の広い画面で詳細を開いていないときは2列にする（右側が空かないように）
        <ul className={cn("divide-y border-y", !selectedId && "lg:grid lg:grid-cols-2 lg:gap-x-4 lg:divide-y-0 lg:border-y-0 lg:px-4")}>
          {venues.map((v) => (
            <li key={v.id} className={cn(!selectedId && "lg:border-b")}>
              <Link
                href={`/venues/${v.id}${query ? `?${query}` : ""}`}
                className={cn("flex h-full min-h-16 flex-col justify-center px-4 py-2 hover:bg-accent", !selectedId && "lg:rounded-xl lg:px-3", v.id === selectedId && "bg-brand-50")}
              >
                <span className="flex items-center gap-2 font-medium">
                  <VenueColorDot color={v.color} />
                  {v.name}
                  {!v.is_active && <Badge tone="muted">未使用</Badge>}
                </span>
                <span className="truncate text-sm text-muted-foreground">
                  {[masters.areaById.get(v.area_id ?? "")?.name, v.nearest_station, v.address].filter(Boolean).join(" / ")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
