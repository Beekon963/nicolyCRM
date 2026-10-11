import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { requireMember } from "@/lib/auth";
import { addDays, todayJst } from "@/lib/date";
import { readServiceAccount } from "@/lib/google/sheets";
import { calendarConflicts, getTrainingSettings, loadAdminSlots, slotParts } from "@/lib/data/trainings";
import { siteUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { SlotForm } from "./slot-form";
import { SlotList } from "./slot-list";
import { TrainingLink } from "./training-link";
import { TrainingSettingsButton } from "./training-settings";

export const metadata = { title: "研修の予約 | NICOLY CRM" };

/** オンライン研修の日程調整（TimeRex のような予約）。枠を作って予約用リンクを送る */
export default async function TrainingsPage({ searchParams }: PageProps<"/trainings">) {
  const me = await requireMember();
  const sp = await searchParams;
  const past = sp.past === "1";
  const isOwner = me.role === "owner";
  const supabase = await createClient();
  const [slots, settings, { data: link }] = await Promise.all([
    loadAdminSlots(past),
    getTrainingSettings(),
    supabase.from("share_links").select("token, is_active").eq("kind", "training").maybeSingle(),
  ]);
  const conflicts = past ? null : await calendarConflicts(slots);
  const linkUrl = link ? `${siteUrl()}/t/${link.token}` : null;
  const today = todayJst();

  const extra = (
    <>
      <TrainingLink link={link && linkUrl ? { url: linkUrl, active: link.is_active } : null} isOwner={isOwner} />
      {isOwner && <TrainingSettingsButton settings={settings} serviceEmail={readServiceAccount()?.client_email ?? null} />}
    </>
  );

  return (
    <>
      <PageHeader
        title="研修の予約"
        description="オンライン研修の日時（枠）を作って、予約用リンクを LINE で送ります。受ける人は空いている日時を選んで予約します。"
      />
      <div className="flex flex-col gap-4 px-4 pb-8">
        {past ? (
          <div className="flex flex-wrap gap-2">{extra}</div>
        ) : (
          <SlotForm defaults={{ title: settings.defaultTitle, meetingUrl: settings.defaultUrl }} today={today} days={Array.from({ length: 21 }, (_, i) => addDays(today, i))} extra={extra} />
        )}
        {/* ほかの画面と同じ切り替え（灰色の地に白い札） */}
        <div className="flex w-fit gap-1 rounded-xl bg-muted p-1" role="tablist">
          {[
            { label: "これから", href: "/trainings", on: !past },
            { label: "過去（60日）", href: "/trainings?past=1", on: past },
          ].map((t) => (
            <Link
              key={t.href}
              href={t.href}
              role="tab"
              aria-selected={t.on}
              className={cn("inline-flex h-10 items-center rounded-md px-4 whitespace-nowrap", t.on ? "bg-background font-semibold text-foreground shadow-[0_1px_3px_rgb(16_24_40/0.1),0_1px_2px_rgb(16_24_40/0.06)]" : "text-muted-foreground")}
            >
              {t.label}
            </Link>
          ))}
        </div>
        <SlotList
          past={past}
          site={siteUrl()}
          linkActive={link?.is_active ?? false}
          calendarLinked={conflicts != null}
          slots={slots.map((s) => ({ ...s, ...slotParts(s.startsAt, s.endsAt), conflict: conflicts?.has(s.id) ?? false }))}
        />
      </div>
    </>
  );
}
