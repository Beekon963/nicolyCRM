import { ExternalLinkIcon, UserSearchIcon } from "lucide-react";
import Link from "next/link";
import { Field, Section } from "@/components/app/list-detail";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { addDays, formatLongJa, todayJst } from "@/lib/date";
import type { EventDetail as Detail } from "@/lib/data/events";
import type { Masters } from "@/lib/data/masters";
import { mapUrl } from "@/lib/data/venues";
import { EVENT_STATUS } from "@/lib/labels";
import { buildMessage } from "@/lib/messages";
import { siteUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { formatTime, formatTimeRange } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { AssignmentPanel, type PanelAssignment } from "./assignment-panel";
import { EventActions } from "./event-actions";

export async function EventDetailView({ detail, masters, back }: { detail: Detail; masters: Masters; back: string }) {
  const { event: e, venue, requirements, assignments } = detail;
  const supabase = await createClient();
  const { data: templates } = await supabase.from("message_templates").select("kind, body");
  const tpl = (k: string) => templates?.find((t) => t.kind === k)?.body ?? "";
  const today = todayJst();
  const isPast = e.date! < today;
  const isTomorrowOrToday = e.date === today || e.date === addDays(today, 1);
  const msgEvent = { ...e, date: e.date!, venue: { name: venue.name, address: venue.address } };
  const site = siteUrl();

  const byRole = requirements
    .map((r) => {
      const confirmed = assignments.filter((a) => a.role_id === r.role_id && a.status === "confirmed").length;
      return { ...r, name: masters.roleById.get(r.role_id)?.name ?? "", confirmed, shortage: Math.max(0, r.required_count - confirmed) };
    })
    .sort((a, b) => (masters.roleById.get(a.role_id)?.sort_order ?? 0) - (masters.roleById.get(b.role_id)?.sort_order ?? 0));
  const overCapacity = byRole.filter((r) => r.confirmed > r.required_count).map((r) => r.name);

  const panel: PanelAssignment[] = assignments
    .filter((a) => a.staff)
    .map((a) => {
      const roleName = masters.roleById.get(a.role_id)?.name ?? "";
      const msg = (k: string) => buildMessage(tpl(k), msgEvent, a.staff!, { siteUrl: site, roleName });
      return {
        id: a.id,
        staffId: a.staff_id,
        name: a.staff!.name,
        roleName,
        status: a.status,
        responseSource: a.response_source,
        respondedAt: a.responded_at,
        offeredAt: a.offered_at,
        confirmNoticeSent: Boolean(a.confirm_notice_sent_at),
        reminderSent: Boolean(a.reminder_sent_at),
        reported: Boolean(a.report?.submitted_at),
        messages: { offer: msg("offer"), confirm: msg("confirm"), reminder: msg("reminder"), report: msg("report_request") },
      };
    });

  const status = EVENT_STATUS[e.status!];

  return (
    <div className="pb-8">
      <PageHeader
        back={back}
        title={venue.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{formatLongJa(e.date!)}</span>
            {e.client?.name}
            <Badge tone={status.tone}>{status.label}</Badge>
          </span>
        }
        actions={<EventActions id={e.id!} date={e.date!} cancelled={Boolean(e.cancelled_at)} />}
        actionsBelow
      />
      {e.cancelled_at && (
        <p className="mx-4 mb-4 rounded-md border bg-muted p-3 text-muted-foreground">この現場は中止です。{e.cancel_reason && `理由: ${e.cancel_reason}`}</p>
      )}
      {e.group && (
        <p className="mx-4 mb-2 text-sm">
          グループ:{" "}
          <Link href={`/events?group=${e.group.id}`} className="text-primary hover:underline">
            {e.group.name}
          </Link>
        </p>
      )}

      <Section
        title="必要人数"
        actions={
          !e.cancelled_at && (
            <Button asChild size="sm">
              <Link href={`/events/${e.id}/candidates`}>
                <UserSearchIcon />
                候補を探す
              </Link>
            </Button>
          )
        }
      >
        <ul className="grid gap-2 sm:grid-cols-3">
          {byRole.map((r) => (
            <li
              key={r.role_id}
              className={cn(
                "flex items-center justify-between rounded-md border p-3",
                r.shortage > 0 && !e.cancelled_at ? "border-status-alert/40 bg-status-alert-bg" : "border-status-done/40 bg-status-done-bg",
              )}
            >
              <span>{r.name}</span>
              <span className={cn("font-bold", r.shortage > 0 && !e.cancelled_at ? "text-status-alert" : "text-status-done")}>
                {r.confirmed}/{r.required_count}人{r.shortage > 0 && ` 欠員${r.shortage}`}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="アサイン">
        <AssignmentPanel assignments={panel} isPast={isPast} isTomorrowOrToday={isTomorrowOrToday} overCapacityRoles={overCapacity} />
      </Section>

      <Section title="現場の情報">
        <dl>
          <Field label="時間">{formatTimeRange(e.start_time, e.end_time)}</Field>
          <Field label="集合">{[formatTime(e.meeting_time), e.meeting_place].filter(Boolean).join(" ")}</Field>
          <Field label="服装・持ち物">{e.belongings && <span className="whitespace-pre-wrap">{e.belongings}</span>}</Field>
          <Field label="注意事項">{e.notes && <span className="whitespace-pre-wrap">{e.notes}</span>}</Field>
          <Field label="取引先">
            {e.client && (
              <Link href={`/sales/${e.client.id}`} className="text-primary hover:underline">
                {e.client.name}
              </Link>
            )}
          </Field>
        </dl>
      </Section>

      <Section
        title="会場の情報"
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href={`/venues/${venue.id}`}>会場の詳細</Link>
          </Button>
        }
      >
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
        </dl>
      </Section>

      {isPast && (
        <Section
          title="実績"
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link href={`/results?event=${e.id}`}>実績確認へ</Link>
            </Button>
          }
        >
          <p className="text-sm">
            報告済み {panel.filter((a) => a.status === "confirmed" && a.reported).length}/{panel.filter((a) => a.status === "confirmed").length}人、
            未確定 {e.unconfirmed_result_count}人
          </p>
        </Section>
      )}
    </div>
  );
}
