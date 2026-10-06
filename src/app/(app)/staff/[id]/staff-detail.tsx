import { PencilIcon, PhoneIcon } from "lucide-react";
import Link from "next/link";
import { AssignmentRow } from "@/components/app/assignment-row";
import { AvailabilityCalendar } from "@/components/app/availability-calendar";
import { Field, Section } from "@/components/app/list-detail";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AppUser } from "@/lib/auth";
import { monthOf, monthRange, nextMonth, todayJst } from "@/lib/date";
import { holidaysBetween } from "@/lib/date/holidays";
import type { Masters } from "@/lib/data/masters";
import type { StaffDetail as Detail } from "@/lib/data/staff";
import { INPUT_SOURCE, STAFF_STATUS } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/supabase/env";
import { PrivateSection } from "./private-section";
import { MypageUrlCard, NgSection, NotesSection } from "./staff-sections";

export async function StaffDetail({ detail, masters, user, back }: { detail: Detail; masters: Masters; user: AppUser; back: string }) {
  const { staff, assignments, ng, notes, availability, submissions } = detail;
  const supabase = await createClient();
  const today = todayJst();
  const thisMonth = monthOf(today);
  const months = [thisMonth, nextMonth(thisMonth)];

  const [{ data: venues }, { data: clients }, priv] = await Promise.all([
    supabase.from("venues").select("id, name").eq("is_active", true).order("name"),
    supabase.from("companies").select("id, name").eq("kind", "client").eq("is_active", true).order("name"),
    // ★ 金額系はオーナーのときだけ取りに行く（管理者は RLS でも 0 件）
    user.role === "owner"
      ? supabase.from("staff_private").select("*").eq("staff_id", staff.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const holidays = holidaysBetween(monthRange(months[0]).start, monthRange(months[1]).end);
  const upcoming = assignments.filter((a) => a.event.date >= today && ["offered", "confirmed", "waitlisted"].includes(a.status));
  const past = assignments.filter((a) => a.event.date < today).reverse().slice(0, 30);
  const marks = Object.fromEntries(
    assignments
      .filter((a) => a.status === "confirmed" && !a.event.cancelled_at)
      .map((a) => [a.event.date, a.event.venue?.name?.slice(0, 4) ?? "現場"]),
  );
  const roleNames = staff.staff_roles.map((r) => masters.roleById.get(r.role_id)?.name).filter(Boolean);
  const areaNames = staff.staff_areas.map((a) => masters.areaById.get(a.area_id)?.name).filter(Boolean);
  const rank = masters.rankById.get(staff.rank_id ?? "");

  return (
    <div className="pb-8">
      <PageHeader
        back={back}
        title={
          <span className="flex items-center gap-2">
            {staff.name}
            {rank && <Badge tone="brand">{rank.name}</Badge>}
            <Badge tone={STAFF_STATUS[staff.status].tone}>{STAFF_STATUS[staff.status].label}</Badge>
          </span>
        }
        description={staff.kana}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/staff/${staff.id}/edit`}>
              <PencilIcon />
              編集
            </Link>
          </Button>
        }
      />

      <Section title="基本情報">
        <dl>
          <Field label="電話">
            {staff.phone && (
              <a href={`tel:${staff.phone.replace(/[^0-9+]/g, "")}`} className="inline-flex items-center gap-1 text-primary">
                <PhoneIcon className="size-4" />
                {staff.phone}
              </a>
            )}
          </Field>
          <Field label="LINE表示名">{staff.line_name}</Field>
          <Field label="最寄り駅">{staff.nearest_station}</Field>
          <Field label="役割">{roleNames.join("・")}</Field>
          <Field label="対応エリア">{areaNames.join("・")}</Field>
          <Field label="メモ">{staff.memo && <span className="whitespace-pre-wrap">{staff.memo}</span>}</Field>
        </dl>
      </Section>

      <Section title="マイページURL">
        <MypageUrlCard staffId={staff.id} name={staff.name} url={`${siteUrl()}/m/${staff.mypage_token}`} />
      </Section>

      <Section
        title="稼働可能日"
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href={`/availability/${staff.id}?month=${months[1]}`}>代理入力</Link>
          </Button>
        }
      >
        <div className="grid gap-6 lg:grid-cols-2">
          {months.map((m) => {
            const sub = submissions.find((s) => s.month === `${m}-01`);
            return (
              <div key={m} className="flex flex-col gap-2">
                <AvailabilityCalendar month={m} values={availability} holidays={holidays} marks={marks} />
                <p className="text-sm">
                  {sub?.submitted_at ? (
                    <Badge tone="done">提出済み（{INPUT_SOURCE[sub.source]}）</Badge>
                  ) : (
                    <Badge tone="waiting">未提出</Badge>
                  )}
                  {sub?.memo && <span className="ml-2 text-muted-foreground">メモ: {sub.memo}</span>}
                </p>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title={`今後の予定（${upcoming.length}件）`}>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">予定はありません</p>
        ) : (
          <ul className="divide-y">
            {upcoming.map((a) => (
              <AssignmentRow key={a.id} a={a} roleName={masters.roleById.get(a.role_id)?.name} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="過去の稼働と獲得実績（直近30件）">
        {past.length === 0 ? (
          <p className="text-sm text-muted-foreground">まだ稼働はありません</p>
        ) : (
          <ul className="divide-y">
            {past.map((a) => (
              <AssignmentRow key={a.id} a={a} roleName={masters.roleById.get(a.role_id)?.name} showResults />
            ))}
          </ul>
        )}
      </Section>

      <Section title="NG設定">
        <NgSection staffId={staff.id} items={ng} venues={venues ?? []} clients={clients ?? []} />
      </Section>

      <Section title="稼働履歴メモ">
        <NotesSection staffId={staff.id} today={today} notes={notes} />
      </Section>

      {user.role === "owner" && (
        <Section title="お金・契約（オーナーのみ）" className="border-primary/30">
          <PrivateSection staffId={staff.id} initial={priv.data} />
        </Section>
      )}
    </div>
  );
}
