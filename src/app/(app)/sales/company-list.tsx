import Link from "next/link";
import { Suspense } from "react";
import { FilterBar } from "@/components/app/filter-bar";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatShortJa } from "@/lib/date";
import { needsNextAction, type listCompanies } from "@/lib/data/companies";
import { COMPANY_STATUS } from "@/lib/labels";
import { cn } from "@/lib/utils";

export function CompanyList({
  companies,
  kind,
  query,
  today,
  selectedId,
}: {
  companies: Awaited<ReturnType<typeof listCompanies>>;
  kind: "client" | "partner";
  query: string;
  today: string;
  selectedId?: string;
}) {
  const tab = (k: "client" | "partner", label: string) => (
    <Link
      href={`/sales?kind=${k}`}
      className={cn(
        "flex h-11 flex-1 items-center justify-center rounded-md text-base",
        kind === k ? "bg-background font-bold shadow-sm" : "text-muted-foreground",
      )}
    >
      {label}
    </Link>
  );
  return (
    <>
      <PageHeader
        title="営業"
        description={`${companies.length}社`}
        actions={
          <Button asChild size="sm">
            <Link href={`/sales/new?kind=${kind}`}>＋ 登録</Link>
          </Button>
        }
      />
      <div className="mx-4 mb-3 flex gap-1 rounded-lg bg-muted p-1">
        {tab("client", "取引先")}
        {tab("partner", "協力会社")}
      </div>
      <Suspense>
        <FilterBar
          basePath="/sales"
          searchPlaceholder="会社名・電話番号"
          filters={[
            {
              name: "status",
              label: "ステータス",
              options: (Object.keys(COMPANY_STATUS) as (keyof typeof COMPANY_STATUS)[]).map((k) => ({ value: k, label: COMPANY_STATUS[k].label })),
            },
          ]}
        />
      </Suspense>
      {companies.length === 0 ? (
        <EmptyState
          title={kind === "client" ? "取引先がまだありません" : "協力会社がまだありません"}
          action={<Button asChild><Link href={`/sales/new?kind=${kind}`}>登録する</Link></Button>}
        >
          「データ取り込み」から CSV でまとめて登録することもできます。
        </EmptyState>
      ) : (
        <ul className="divide-y border-y">
          {companies.map((c) => {
            const overdue = c.next_action_date != null && c.next_action_date <= today;
            const missing = needsNextAction(c.status) && (!c.next_action_date || !c.next_action);
            return (
              <li key={c.id}>
                <Link
                  href={`/sales/${c.id}${query ? `?${query}` : ""}`}
                  className={cn("flex min-h-16 items-center gap-3 px-4 py-2 hover:bg-accent", c.id === selectedId && "bg-primary/10")}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{c.name}</span>
                      <Badge tone={COMPANY_STATUS[c.status].tone}>{COMPANY_STATUS[c.status].label}</Badge>
                    </span>
                    <span className={cn("block truncate text-sm", overdue ? "font-medium text-status-alert" : "text-muted-foreground")}>
                      {c.next_action_date ? `${formatShortJa(c.next_action_date)} ${c.next_action}` : missing ? "" : c.owner?.name ?? ""}
                    </span>
                  </span>
                  {missing && <Badge tone="alert">次回アクション未設定</Badge>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
