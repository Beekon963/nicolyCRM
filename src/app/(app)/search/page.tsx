import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { requireMember } from "@/lib/auth";
import { addDays, formatShortJa, todayJst } from "@/lib/date";
import { COMPANY_KIND, STAFF_STATUS } from "@/lib/labels";
import { digitsOnly, searchNorm } from "@/lib/search";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "検索 | NICOLY CRM" };

/** PostgREST の or() に入れる部分一致（値はダブルクォートで囲んでカンマなどを無害にする） */
function orLike(cols: string[], value: string) {
  const v = `%${value.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/"/g, "")}%`;
  return cols.map((c) => `${c}.ilike."${v}"`).join(",");
}

/** 横断検索（要件 §4.11）。ひらがな / カタカナ、電話番号のハイフン有無を吸収する */
export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  await requireMember();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const norm = searchNorm(q);
  const digits = digitsOnly(q);
  if (!norm) {
    return (
      <>
        <PageHeader title="検索" />
        <EmptyState title="上の検索窓に、名前・会社名・会場名・電話番号などを入れてください" />
      </>
    );
  }

  const supabase = await createClient();
  const textOr = (extra: string[] = []) => [orLike(["search_text"], norm), ...(digits.length >= 3 ? extra.map((c) => orLike([c], digits)) : [])].join(",");
  const [staff, companies, contacts, venues] = await Promise.all([
    supabase.from("staff").select("id, name, kana, phone, status").or(textOr(["phone_digits"])).limit(20),
    supabase.from("companies").select("id, name, kind, phone").or(textOr(["phone_digits"])).limit(20),
    supabase.from("contacts").select("id, name, title, phone, company:companies(id, name)").or(textOr(["phone_digits"])).limit(20),
    supabase.from("venues").select("id, name, address, nearest_station").or(textOr()).limit(20),
  ]);
  const venueIds = (venues.data ?? []).map((v) => v.id);
  const clientIds = (companies.data ?? []).filter((c) => c.kind === "client").map((c) => c.id);
  const events =
    venueIds.length || clientIds.length
      ? await supabase
          .from("events")
          .select("id, date, cancelled_at, venue:venues(name), client:companies(name)")
          .or([venueIds.length && `venue_id.in.(${venueIds.join(",")})`, clientIds.length && `client_id.in.(${clientIds.join(",")})`].filter(Boolean).join(","))
          .gte("date", addDays(todayJst(), -30))
          .order("date")
          .limit(20)
      : { data: [] };

  const total = [staff, companies, contacts, venues].reduce((s, r) => s + (r.data?.length ?? 0), 0) + (events.data?.length ?? 0);

  return (
    <>
      <PageHeader title={`「${q}」の検索結果`} description={`${total}件`} />
      {total === 0 && <EmptyState title="見つかりませんでした">別の言葉や、電話番号の一部で探してみてください。</EmptyState>}
      <Group title="スタッフ" items={(staff.data ?? []).map((s) => ({ href: `/staff/${s.id}`, title: s.name, sub: [s.kana, s.phone].filter(Boolean).join(" / "), badge: s.status !== "active" ? STAFF_STATUS[s.status].label : undefined }))} />
      <Group title="会社" items={(companies.data ?? []).map((c) => ({ href: `/sales/${c.id}`, title: c.name, sub: c.phone, badge: COMPANY_KIND[c.kind] }))} />
      <Group title="先方の担当者" items={(contacts.data ?? []).map((c) => ({ href: `/sales/${c.company?.id}`, title: c.name, sub: [c.company?.name, c.title, c.phone].filter(Boolean).join(" / ") }))} />
      <Group title="会場" items={(venues.data ?? []).map((v) => ({ href: `/venues/${v.id}`, title: v.name, sub: [v.nearest_station, v.address].filter(Boolean).join(" / ") }))} />
      <Group
        title="現場（直近30日〜）"
        items={(events.data ?? []).map((e) => ({ href: `/events/${e.id}`, title: `${formatShortJa(e.date)} ${e.venue?.name ?? ""}`, sub: e.client?.name ?? "", badge: e.cancelled_at ? "中止" : undefined }))}
      />
    </>
  );
}

function Group({ title, items }: { title: string; items: { href: string; title: string; sub?: string; badge?: string }[] }) {
  if (!items.length) return null;
  return (
    <section className="mx-4 mb-4">
      <h2 className="mb-1 text-sm font-bold text-muted-foreground">
        {title}（{items.length}）
      </h2>
      <ul className="divide-y rounded-lg border">
        {items.map((i, idx) => (
          <li key={`${i.href}-${idx}`}>
            <Link href={i.href} className="flex min-h-14 items-center gap-2 px-3 py-2 hover:bg-accent">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 font-medium">
                  {i.title}
                  {i.badge && <Badge tone="muted">{i.badge}</Badge>}
                </span>
                {i.sub && <span className="block truncate text-sm text-muted-foreground">{i.sub}</span>}
              </span>
              <ChevronRightIcon className="size-5 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
