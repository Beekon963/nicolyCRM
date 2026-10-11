import { PageHeader } from "@/components/app/page-header";
import { Badge, type Tone } from "@/components/ui/badge";
import { requireMember } from "@/lib/auth";
import { formatShortJa, formatTimeJst, toJstDateString } from "@/lib/date";
import { lineConfig } from "@/lib/line/client";
import { getLineSettings, lineBot } from "@/lib/line/notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { LineSettingsForm } from "./line-settings";
import { MyLine } from "./my-line";

export const metadata = { title: "LINE の通知 | NICOLY CRM" };

const KIND: Record<string, string> = {
  confirm: "スタッフに確定",
  reminder: "スタッフに前日",
  admin_confirm: "社内に確定",
  admin_events: "社内に新しい現場",
};
const STATUS: Record<string, { label: string; tone: Tone }> = {
  sent: { label: "送った", tone: "done" },
  skipped: { label: "送らなかった", tone: "muted" },
  failed: { label: "送れなかった", tone: "alert" },
  pending: { label: "送る前", tone: "waiting" },
};

/** LINE 公式アカウントからの自動のお知らせ（Phase 5）。自分の LINE をつなぐ・何を送るか（オーナー）・送った記録 */
export default async function NotificationsPage() {
  const me = await requireMember();
  const isOwner = me.role === "owner";
  const configured = lineConfig() != null;
  const supabase = await createClient();
  const [bot, settings, { data: mine }, { data: staff }, { data: log }] = await Promise.all([
    lineBot(),
    // 設定は秘密キーなしでも読めるが、初めの値をそろえるため同じ読み方にする
    getLineSettings(createAdminClient()),
    supabase.from("app_users").select("line_user_id").eq("id", me.id).maybeSingle(),
    supabase.from("staff").select("id, name, kana, line_user_id").eq("status", "active").order("kana"),
    supabase
      .from("line_outbox")
      .select("id, kind, status, note, created_at, assignment:assignments(staff:staff(name), event:events(date, venue:venues(name)))")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  const linkedStaff = (staff ?? []).filter((s) => s.line_user_id);
  const notLinked = (staff ?? []).filter((s) => !s.line_user_id);
  const at = (iso: string) => {
    const d = new Date(iso);
    return `${formatShortJa(toJstDateString(d))} ${formatTimeJst(d)}`;
  };

  return (
    <>
      <PageHeader title="LINE の通知" description="LINE 公式アカウントから、確定・前日・新しい現場のお知らせを自動で送ります。" />
      <div className="flex flex-col gap-6 px-4 pb-8">
        {!configured || !bot ? (
          <p className="rounded-lg border border-dashed p-4 text-muted-foreground">
            {isOwner
              ? configured
                ? "LINE 公式アカウントにつながりません。Vercel の LINE_CHANNEL_ACCESS_TOKEN が正しいか確かめてください（docs/setup.md ⑫）。"
                : "LINE 公式アカウントの準備がまだです。docs/setup.md の ⑫ の手順で公式アカウントを作り、Vercel に LINE_CHANNEL_ACCESS_TOKEN と LINE_CHANNEL_SECRET を入れてください。"
              : "LINE の通知はまだ使えません。オーナーに設定を頼んでください。"}
          </p>
        ) : (
          <>
            <section className="flex flex-col gap-2 rounded-lg border p-4">
              <h2 className="text-lg font-bold">自分の LINE</h2>
              <MyLine linked={Boolean(mine?.line_user_id)} botName={bot.displayName || bot.basicId} />
            </section>

            {isOwner && (
              <section className="flex flex-col gap-3 rounded-lg border p-4">
                <h2 className="text-lg font-bold">送るお知らせ（オーナー）</h2>
                <p className="text-sm text-muted-foreground">
                  公式アカウント「{bot.displayName}」（{bot.basicId}）につながっています。月の稼働表の取り込みでは送りません。
                </p>
                <LineSettingsForm initial={settings} />
              </section>
            )}

            <section className="flex flex-col gap-2 rounded-lg border p-4">
              <h2 className="text-lg font-bold">
                LINE とつながっているスタッフ {linkedStaff.length}/{(staff ?? []).length}人
              </h2>
              {notLinked.length > 0 ? (
                <details>
                  <summary className="cursor-pointer text-muted-foreground">まだつながっていない人（{notLinked.length}人）</summary>
                  <p className="mt-2 text-sm leading-relaxed">{notLinked.map((s) => s.name).join("、")}</p>
                  <p className="mt-2 text-sm text-muted-foreground">マイページのいちばん下の「LINE とつなぐ」から、本人がつなぎます。つながっていない人には、今までどおり画面の「LINEで送る」で送ってください。</p>
                </details>
              ) : (
                <p className="text-muted-foreground">稼働中のスタッフは全員つながっています。</p>
              )}
            </section>
          </>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-bold">送った記録（新しい順）</h2>
          {!log?.length ? (
            <p className="rounded-lg border border-dashed p-4 text-center text-muted-foreground">まだありません。上の設定をオンにすると、確定したときなどにここへ記録が出ます。</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-xl border bg-card">
              {log.map((l) => {
                const a = l.assignment;
                return (
                  <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                    <span className="text-sm text-muted-foreground tabular-nums">{at(l.created_at)}</span>
                    <span className="font-medium">{KIND[l.kind] ?? ""}</span>
                    {a?.event && (
                      <span className="text-sm">
                        {formatShortJa(a.event.date)} {a.event.venue?.name} {a.staff?.name}
                      </span>
                    )}
                    <Badge tone={STATUS[l.status]?.tone ?? "muted"} className="ml-auto">
                      {STATUS[l.status]?.label ?? ""}
                    </Badge>
                    {l.note && <span className="w-full text-sm text-muted-foreground">{l.note}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
