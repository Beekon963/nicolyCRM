import Link from "next/link";
import { Suspense } from "react";
import { RecordActivityButton } from "@/components/app/activity-sheet";
import { FilterBar } from "@/components/app/filter-bar";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatShortJa } from "@/lib/date";
import type { CompanyListRow } from "@/lib/data/companies";
import { COMPANY_STATUS, PRIORITY } from "@/lib/labels";
import { type CompanyStatus, isNextActionMissing } from "@/lib/sales";
import { cn } from "@/lib/utils";

/** 次回アクションの1行（期限切れは赤、今日は太字、未設定は赤のバッジ。要件 §4.8） */
function NextAction({ c, today }: { c: CompanyListRow; today: string }) {
  if (c.next_action_date) {
    const overdue = c.next_action_date < today;
    return (
      <span className={cn("block truncate text-sm", overdue ? "font-bold text-status-alert" : c.next_action_date === today ? "font-bold" : "text-muted-foreground")}>
        {overdue ? "期限切れ " : c.next_action_date === today ? "今日 " : ""}
        {formatShortJa(c.next_action_date)} {c.next_action}
      </span>
    );
  }
  if (isNextActionMissing(c)) return <Badge tone="alert">次回アクション未設定</Badge>;
  return null;
}

export function CompanyList({
  companies,
  kind,
  query,
  today,
  selectedId,
  users,
  view = "list",
}: {
  companies: CompanyListRow[];
  kind: "client" | "partner";
  query: string;
  today: string;
  selectedId?: string;
  users: { id: string; name: string }[];
  view?: "list" | "kanban";
}) {
  const params = new URLSearchParams(query);
  const href = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    return `/sales?${next.toString()}`;
  };
  const tab = (k: "client" | "partner", label: string) => (
    <Link
      href={`/sales?kind=${k}${view === "kanban" ? "&view=kanban" : ""}`}
      className={cn("flex h-11 flex-1 items-center justify-center rounded-md text-base", kind === k ? "bg-background font-bold shadow-sm" : "text-muted-foreground")}
    >
      {label}
    </Link>
  );
  const missing = companies.filter((c) => isNextActionMissing(c)).length;
  const due = companies.filter((c) => c.next_action_date != null && c.next_action_date <= today).length;
  const linkQuery = new URLSearchParams(params);
  linkQuery.delete("view");
  const detailHref = (id: string) => `/sales/${id}${linkQuery.size ? `?${linkQuery}` : ""}`;

  return (
    <>
      <PageHeader
        title="営業"
        description={
          <>
            {companies.length}社
            {due > 0 && <span className="ml-2 font-bold text-status-alert">今日までの予定 {due}社</span>}
            {missing > 0 && <span className="ml-2 font-bold text-status-alert">未設定 {missing}社</span>}
          </>
        }
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
            // スマホ幅でも切れないよう、何も選んでいないときは項目名だけを出す
            ...(view === "list"
              ? [
                  {
                    name: "status",
                    label: "ステータス",
                    allLabel: "ステータス",
                    options: (Object.keys(COMPANY_STATUS) as CompanyStatus[]).map((k) => ({ value: k, label: COMPANY_STATUS[k].label })),
                  },
                ]
              : []),
            {
              name: "next",
              label: "次回アクション",
              allLabel: "次回アクション",
              options: [
                { value: "due", label: "次回 今日まで" },
                { value: "missing", label: "次回 未設定" },
              ],
            },
            {
              name: "owner",
              label: "担当者",
              allLabel: "担当者",
              options: [{ value: "me", label: "担当 自分" }, ...users.map((u) => ({ value: u.id, label: `担当 ${u.name}` })), { value: "none", label: "担当者なし" }],
            },
            { name: "priority", label: "優先度", allLabel: "優先度", options: (["high", "mid", "low"] as const).map((p) => ({ value: p, label: `優先度 ${PRIORITY[p]}` })) },
          ]}
        />
      </Suspense>
      {!selectedId && (
        <div className="mx-4 mb-3 flex w-fit gap-1 rounded-lg bg-muted p-1 text-sm" role="group" aria-label="表示">
          {(["list", "kanban"] as const).map((v) => (
            <Link
              key={v}
              href={href({ view: v === "list" ? null : v })}
              aria-current={view === v ? "page" : undefined}
              className={cn("flex h-9 items-center rounded-md px-4", view === v ? "bg-background font-bold shadow-sm" : "text-muted-foreground")}
            >
              {v === "list" ? "リスト" : "カンバン"}
            </Link>
          ))}
        </div>
      )}
      {companies.length === 0 ? (
        params.size > (params.has("kind") ? 1 : 0) + (params.has("view") ? 1 : 0) ? (
          <EmptyState title="条件に合う会社はありません" action={<Button asChild variant="outline"><Link href={`/sales?kind=${kind}`}>絞り込みを外す</Link></Button>} />
        ) : (
          <EmptyState
            title={kind === "client" ? "取引先がまだありません" : "協力会社がまだありません"}
            action={<Button asChild><Link href={`/sales/new?kind=${kind}`}>登録する</Link></Button>}
          >
            「データ取り込み」から CSV でまとめて登録することもできます。
          </EmptyState>
        )
      ) : view === "kanban" && !selectedId ? (
        <Kanban companies={companies} today={today} detailHref={detailHref} />
      ) : (
        <ul className="divide-y border-y">
          {companies.map((c) => (
            <li key={c.id} className={cn("flex items-center gap-1 pr-2", c.id === selectedId && "bg-primary/10")}>
              <Link href={detailHref(c.id)} className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2 pl-4 hover:bg-accent">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{c.name}</span>
                    <Badge tone={COMPANY_STATUS[c.status].tone}>{COMPANY_STATUS[c.status].label}</Badge>
                    {c.priority === "high" && <Badge tone="brand">優先度 高</Badge>}
                  </span>
                  <NextAction c={c} today={today} />
                  {c.owner && <span className="block truncate text-sm text-muted-foreground">担当 {c.owner.name}</span>}
                </span>
              </Link>
              <RecordActivityButton company={c} variant="outline" size="sm" label="記録" />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** ステータスごとの列（要件 §4.8「リスト / カンバン切替」）。スマホでは表の中だけ横に動かす */
function Kanban({ companies, today, detailHref }: { companies: CompanyListRow[]; today: string; detailHref: (id: string) => string }) {
  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex w-max gap-3 px-4">
        {(Object.keys(COMPANY_STATUS) as CompanyStatus[]).map((s) => {
          const list = companies.filter((c) => c.status === s);
          return (
            <section key={s} aria-label={COMPANY_STATUS[s].label} className="flex w-64 shrink-0 flex-col gap-2 rounded-lg bg-muted/60 p-2">
              <h2 className="flex items-center justify-between px-1 font-bold">
                <Badge tone={COMPANY_STATUS[s].tone}>{COMPANY_STATUS[s].label}</Badge>
                <span className="text-sm text-muted-foreground">{list.length}社</span>
              </h2>
              {list.length === 0 && <p className="px-1 py-2 text-sm text-muted-foreground">なし</p>}
              {list.map((c) => (
                <Link key={c.id} href={detailHref(c.id)} className="flex min-h-14 flex-col gap-0.5 rounded-md border bg-background p-2 hover:bg-accent">
                  <span className="flex items-center gap-1">
                    <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                    {c.priority === "high" && <Badge tone="brand">高</Badge>}
                  </span>
                  <NextAction c={c} today={today} />
                  {c.owner && <span className="truncate text-sm text-muted-foreground">担当 {c.owner.name}</span>}
                </Link>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
