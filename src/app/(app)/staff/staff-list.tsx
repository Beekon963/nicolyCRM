import Link from "next/link";
import { Suspense } from "react";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/app/filter-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Masters } from "@/lib/data/masters";
import type { StaffListItem } from "@/lib/data/staff";
import { STAFF_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";

export function StaffList({
  staff,
  masters,
  query,
  selectedId,
  compact,
}: {
  staff: StaffListItem[];
  masters: Masters;
  query: string;
  selectedId?: string;
  compact?: boolean;
}) {
  const href = (id: string) => `/staff/${id}${query ? `?${query}` : ""}`;
  const names = (ids: string[], map: Map<string, { name: string }>) => ids.map((id) => map.get(id)?.name).filter(Boolean).join("・");

  return (
    <>
      <PageHeader
        title="スタッフ"
        description={`${staff.length}人`}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/availability">提出状況</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/staff/new">＋ 登録</Link>
            </Button>
          </>
        }
      />
      <Suspense>
        <FilterBar
          basePath="/staff"
          searchPlaceholder="氏名・かな・電話番号"
          filters={[
            { name: "role", label: "役割", options: masters.roles.filter((r) => r.is_active).map((r) => ({ value: r.id, label: r.name })) },
            { name: "rank", label: "ランク", options: masters.ranks.filter((r) => r.is_active).map((r) => ({ value: r.id, label: r.name })) },
            { name: "area", label: "エリア", options: masters.areas.filter((r) => r.is_active).map((r) => ({ value: r.id, label: r.name })) },
            {
              name: "status",
              label: "状態",
              allLabel: "状態: 稼働中",
              options: [
                { value: "paused", label: "状態: 休止" },
                { value: "ended", label: "状態: 終了" },
                { value: "all", label: "状態: すべて" },
              ],
            },
          ]}
        />
      </Suspense>

      {staff.length === 0 ? (
        <EmptyState title="該当するスタッフがいません" action={<Button asChild><Link href="/staff/new">スタッフを登録する</Link></Button>}>
          条件を変えるか、新しく登録してください。名簿は「データ取り込み」から CSV でまとめて登録できます。
        </EmptyState>
      ) : (
        <>
          {/* PC で詳細を開いていないとき: 表 */}
          {!compact && (
            <div className="hidden px-4 md:block">
              <table className="w-full text-left">
                <thead className="border-b text-sm text-muted-foreground">
                  <tr>
                    <th className="py-2 font-medium">氏名</th>
                    <th className="font-medium">ランク</th>
                    <th className="font-medium">役割</th>
                    <th className="font-medium">エリア</th>
                    <th className="font-medium">最寄り駅</th>
                    <th className="font-medium">電話</th>
                    <th className="font-medium">状態</th>
                  </tr>
                </thead>
                <tbody>
                  {staff.map((s) => (
                    <tr key={s.id} className="border-b hover:bg-accent">
                      <td className="py-2">
                        <Link href={href(s.id)} className="font-medium text-primary hover:underline">
                          {s.name}
                        </Link>
                        <div className="text-sm text-muted-foreground">{s.kana}</div>
                      </td>
                      <td>{masters.rankById.get(s.rank_id ?? "")?.name ?? "−"}</td>
                      <td className="text-sm">{names(s.role_ids, masters.roleById)}</td>
                      <td className="text-sm">{names(s.area_ids, masters.areaById)}</td>
                      <td className="text-sm">{s.nearest_station}</td>
                      <td className="text-sm">{s.phone}</td>
                      <td>
                        <Badge tone={STAFF_STATUS[s.status].tone}>{STAFF_STATUS[s.status].label}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* スマホ・PC で詳細を開いているとき: カード */}
          <ul className={cn("flex flex-col divide-y border-y", !compact && "md:hidden")}>
            {staff.map((s) => (
              <li key={s.id}>
                <Link
                  href={href(s.id)}
                  className={cn("flex min-h-16 items-center gap-3 px-4 py-2 hover:bg-accent", s.id === selectedId && "bg-primary/10")}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-sm font-bold">
                    {masters.rankById.get(s.rank_id ?? "")?.name ?? "−"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{s.name}</span>
                      {s.status !== "active" && <Badge tone={STAFF_STATUS[s.status].tone}>{STAFF_STATUS[s.status].label}</Badge>}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {[names(s.role_ids, masters.roleById), s.nearest_station].filter(Boolean).join(" / ")}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
