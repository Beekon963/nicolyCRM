import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { requireMember } from "@/lib/auth";
import { addDays, formatShortJa, monthOf, nextMonth, parse, todayJst } from "@/lib/date";
import { INPUT_SOURCE } from "@/lib/labels";
import { mypageUrl } from "@/lib/messages";
import { getGeneralSettings } from "@/lib/settings";
import { siteUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { renderTemplate } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { RequestButtons } from "./request-buttons";

export const metadata = { title: "稼働可能日の提出状況 | NICOLY CRM" };

/** 対象月の締切（翌月分は前月の締切日。要件 §4.6） */
function deadlineFor(month: string, day: number) {
  const prev = addDays(`${month}-01`, -1).slice(0, 7);
  return `${prev}-${String(day).padStart(2, "0")}`;
}

export default async function AvailabilityStatusPage({ searchParams }: PageProps<"/availability">) {
  await requireMember();
  const today = todayJst();
  const thisMonth = monthOf(today);
  const next = nextMonth(thisMonth);
  const sp = await searchParams;
  const month = sp.month === thisMonth ? thisMonth : next;
  const supabase = await createClient();
  const settings = await getGeneralSettings();
  const deadline = deadlineFor(month, settings.availabilityDeadlineDay);
  const late = today > deadline;

  const [{ data: staff }, { data: subs }, { data: tpls }] = await Promise.all([
    supabase.from("staff").select("id, name, kana, mypage_token").eq("status", "active").order("kana"),
    supabase.from("availability_submissions").select("staff_id, submitted_at, source, memo").eq("month", `${month}-01`),
    supabase.from("message_templates").select("kind, body").in("kind", ["availability_request", "availability_reminder"]),
  ]);
  const subMap = new Map((subs ?? []).map((s) => [s.staff_id, s]));
  const rows = (staff ?? []).map((s) => ({ ...s, sub: subMap.get(s.id) }));
  const missing = rows.filter((r) => !r.sub?.submitted_at);
  const done = rows.filter((r) => r.sub?.submitted_at);
  const { m } = parse(`${month}-01`);
  const values = { 対象月: `${m}月`, 締切日: formatShortJa(deadline) };
  const tpl = (k: string) => tpls?.find((t) => t.kind === k)?.body ?? "";
  const site = siteUrl();

  return (
    <>
      <PageHeader title="稼働可能日の提出状況" back="/staff" description={`${m}月分 / 締切 ${formatShortJa(deadline)}`} />
      <div className="mx-4 mb-3 flex gap-1 rounded-lg bg-muted p-1">
        {[thisMonth, next].map((mo) => (
          <Link
            key={mo}
            href={`/availability?month=${mo}`}
            className={cn("flex h-11 flex-1 items-center justify-center rounded-md", mo === month ? "bg-background font-bold shadow-sm" : "text-muted-foreground")}
          >
            {Number(mo.slice(5))}月分
          </Link>
        ))}
      </div>
      <div className="mx-4 mb-4 flex flex-wrap items-center gap-3">
        <Badge tone="done">提出済み {done.length}人</Badge>
        <Badge tone={late ? "alert" : "waiting"}>未提出 {missing.length}人</Badge>
      </div>
      <RequestButtons
        groupText={renderTemplate(tpl("availability_request"), values)}
        reminders={missing.map((r) => ({
          id: r.id,
          name: r.name,
          text: renderTemplate(tpl("availability_reminder"), { ...values, 名前: r.name.split(/[\s　]/)[0], マイページURL: mypageUrl(site, r.mypage_token) }),
        }))}
      />

      <h2 className="mx-4 mt-4 mb-1 font-bold">未提出（{missing.length}人）</h2>
      {missing.length === 0 ? (
        <EmptyState title="全員提出済みです" />
      ) : (
        <ul className="mx-4 divide-y rounded-lg border">
          {missing.map((r) => (
            <li key={r.id} className="flex min-h-14 items-center gap-2 px-3">
              <Link href={`/staff/${r.id}`} className="flex-1 font-medium hover:underline">
                {r.name}
              </Link>
              <Badge tone={late ? "alert" : "waiting"}>未提出</Badge>
              <Link href={`/availability/${r.id}?month=${month}`} className="flex h-11 items-center px-2 text-sm text-primary">
                代理入力
              </Link>
            </li>
          ))}
        </ul>
      )}

      <h2 className="mx-4 mt-6 mb-1 font-bold">提出済み（{done.length}人）</h2>
      <ul className="mx-4 divide-y rounded-lg border">
        {done.map((r) => (
          <li key={r.id} className="flex min-h-14 items-center gap-2 px-3">
            <Link href={`/staff/${r.id}`} className="flex-1 font-medium hover:underline">
              {r.name}
              {r.sub?.memo && <span className="block text-sm font-normal text-muted-foreground">メモ: {r.sub.memo}</span>}
            </Link>
            <span className="text-sm text-muted-foreground">{INPUT_SOURCE[r.sub!.source]}</span>
            <Link href={`/availability/${r.id}?month=${month}`} className="flex h-11 items-center px-2 text-sm text-primary">
              修正
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
