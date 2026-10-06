import Link from "next/link";
import { Suspense } from "react";
import { FilterBar } from "@/components/app/filter-bar";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FIELD_LABEL, formatValue, TABLE_LABEL } from "@/lib/audit-labels";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "変更履歴 | NICOLY CRM" };

const ACTION = { insert: "追加", update: "変更", delete: "削除" } as const;
const PAGE = 50;

/** 変更履歴（オーナーのみ。要件 §4.15） */
export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  await requireOwner();
  const sp = await searchParams;
  const table = typeof sp.table === "string" ? sp.table : "";
  const before = typeof sp.before === "string" ? Number(sp.before) : undefined;
  const supabase = await createClient();
  let q = supabase.from("audit_logs").select("*").order("id", { ascending: false }).limit(PAGE);
  if (table) q = q.eq("table_name", table);
  if (before) q = q.lt("id", before);
  const { data: logs } = await q;
  const rows = logs ?? [];

  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[];
  const staffIds = [...new Set(rows.map((r) => r.staff_id).filter(Boolean))] as string[];
  const [{ data: users }, { data: staff }] = await Promise.all([
    userIds.length ? supabase.from("app_users").select("id, name").in("id", userIds) : Promise.resolve({ data: [] }),
    staffIds.length ? supabase.from("staff").select("id, name").in("id", staffIds) : Promise.resolve({ data: [] }),
  ]);
  const userName = new Map((users ?? []).map((u) => [u.id, u.name]));
  const staffName = new Map((staff ?? []).map((s) => [s.id, s.name]));

  return (
    <>
      <PageHeader title="変更履歴" description="金額・実績・アサインの状態・営業ステータスなどの変更（誰が・いつ・何を・何から何に）" />
      <Suspense>
        <FilterBar
          basePath="/audit"
          filters={[{ name: "table", label: "対象", options: Object.entries(TABLE_LABEL).map(([value, label]) => ({ value, label })) }]}
        />
      </Suspense>
      {rows.length === 0 ? (
        <EmptyState title="変更履歴はありません" />
      ) : (
        <ul className="mx-4 divide-y rounded-lg border">
          {rows.map((r) => {
            const before = (r.before ?? {}) as Record<string, unknown>;
            const after = (r.after ?? {}) as Record<string, unknown>;
            const fields = r.action === "update" ? (r.changed_fields ?? []) : [];
            return (
              <li key={r.id} className="flex flex-col gap-1 p-3 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">{new Date(r.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</span>
                  <Badge tone="brand">{TABLE_LABEL[r.table_name] ?? r.table_name}</Badge>
                  <Badge tone={r.action === "delete" ? "alert" : "muted"}>{ACTION[r.action as keyof typeof ACTION]}</Badge>
                  <span className="font-medium">
                    {r.user_id ? (userName.get(r.user_id) ?? "（ユーザー）") : r.staff_id ? `${staffName.get(r.staff_id) ?? "スタッフ"}（マイページ）` : "システム"}
                  </span>
                </p>
                {r.action === "update" ? (
                  <ul className="pl-2">
                    {fields.map((f) => (
                      <li key={f}>
                        {FIELD_LABEL[f] ?? f}: {formatValue(f, before[f])} → <b>{formatValue(f, after[f])}</b>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="truncate text-muted-foreground">
                    {Object.entries(r.action === "insert" ? after : before)
                      .filter(([k, v]) => FIELD_LABEL[k] && v != null && v !== "")
                      .slice(0, 6)
                      .map(([k, v]) => `${FIELD_LABEL[k]}: ${formatValue(k, v)}`)
                      .join(" / ")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {rows.length === PAGE && (
        <div className="mx-4 mt-3">
          <Button asChild variant="outline">
            <Link href={`/audit?${new URLSearchParams({ ...(table && { table }), before: String(rows.at(-1)!.id) })}`}>さらに古い履歴</Link>
          </Button>
        </div>
      )}
    </>
  );
}
