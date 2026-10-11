import "server-only";
import { addDays, todayJst } from "@/lib/date";
import { buildMessage } from "@/lib/messages";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/supabase/env";
import { LineApiError, LineClient, lineConfig, text } from "./client";
import { adminConfirmText, adminDropText, adminEventsText } from "./messages";

/**
 * LINE 公式アカウントからの自動のお知らせ（Phase 5）。
 * - 画面で確定したとき・現場を作ったとき・確定していた人がキャンセル・当日不稼働になったときに line_outbox に入れ、1分ごとの定期実行（/api/cron/line）で送る
 *   入れてから1分たったものだけ送る（間違えて確定して「元に戻す」を押したときに、お知らせが届かないように）
 * - 前日のお知らせも定期実行で入れる
 * - 送るのはサーバー（秘密キー）。スタッフへの文は文面テンプレート（確定連絡・前日リマインド）で作る。金額は入れない
 * - 月の稼働表の取り込みでは入れない（この関数を呼ばない）
 */

export type LineSettings = { staffConfirm: boolean; reminder: boolean; reminderHour: number; adminNotify: boolean };
export const DEFAULT_LINE_SETTINGS: LineSettings = { staffConfirm: false, reminder: false, reminderHour: 18, adminNotify: false };

type Admin = ReturnType<typeof createAdminClient>;

export async function getLineSettings(admin: Admin = createAdminClient()): Promise<LineSettings> {
  const { data } = await admin.from("settings").select("value").eq("key", "line").maybeSingle();
  const v = (data?.value ?? {}) as Partial<LineSettings>;
  const hour = Number(v.reminderHour);
  return {
    staffConfirm: v.staffConfirm === true,
    reminder: v.reminder === true,
    reminderHour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : DEFAULT_LINE_SETTINGS.reminderHour,
    adminNotify: v.adminNotify === true,
  };
}

/** 確定したとき（画面の操作・マイページの「参加できる」）。actor は操作したオーナー・管理者（本人の回答なら null） */
export async function enqueueConfirmed(assignmentIds: string[], actorUserId: string | null): Promise<void> {
  if (!assignmentIds.length || !lineConfig()) return;
  const admin = createAdminClient();
  const s = await getLineSettings(admin);
  const rows = assignmentIds.flatMap((id) => [
    ...(s.staffConfirm ? [{ kind: "confirm", assignment_id: id, actor_user_id: actorUserId }] : []),
    ...(s.adminNotify ? [{ kind: "admin_confirm", assignment_id: id, actor_user_id: actorUserId }] : []),
  ]);
  if (!rows.length) return;
  await admin.from("line_outbox").insert(rows);
}

/** 確定していた人がキャンセル・当日不稼働になったとき（社内向け。Phase 6） */
export async function enqueueDropped(assignmentId: string, actorUserId: string | null): Promise<void> {
  if (!lineConfig()) return;
  const admin = createAdminClient();
  if (!(await getLineSettings(admin)).adminNotify) return;
  await admin.from("line_outbox").insert({ kind: "admin_cancel", assignment_id: assignmentId, actor_user_id: actorUserId });
}

/** 現場を作ったとき（1件でも、まとめて作っても、1つのお知らせにする） */
export async function enqueueNewEvents(eventIds: string[], actorUserId: string): Promise<void> {
  if (!eventIds.length || !lineConfig()) return;
  const admin = createAdminClient();
  if (!(await getLineSettings(admin)).adminNotify) return;
  await admin.from("line_outbox").insert({ kind: "admin_events", event_ids: eventIds, actor_user_id: actorUserId });
}

/** 前日のお知らせを入れる（決めた時刻を過ぎたら、明日の現場の確定した人へ。1人1回） */
export async function enqueueReminders(now: Date = new Date()): Promise<number> {
  if (!lineConfig()) return 0;
  const admin = createAdminClient();
  const s = await getLineSettings(admin);
  const hourJst = (now.getUTCHours() + 9) % 24;
  if (!s.reminder || hourJst < s.reminderHour) return 0;
  const { data } = await admin.rpc("line_enqueue_reminders", { p_date: addDays(todayJst(now), 1) });
  return data ?? 0;
}

type Outcome = { status: "sent" | "skipped" | "failed" | "pending"; note: string };

/** 入れてから送るまで待つ秒数（画面テストでは 0 にする） */
const delaySeconds = () => {
  const n = Number(process.env.LINE_SEND_DELAY_SECONDS);
  return Number.isFinite(n) && n >= 0 ? n : 60;
};

export async function flushLineOutbox(limit = 50): Promise<{ sent: number; skipped: number; failed: number }> {
  const cfg = lineConfig();
  const result = { sent: 0, skipped: 0, failed: 0 };
  if (!cfg) return result;
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("line_outbox")
    .select("*")
    .eq("status", "pending")
    .lte("created_at", new Date(Date.now() - delaySeconds() * 1000).toISOString())
    .order("created_at")
    .limit(limit);
  if (!rows?.length) return result;

  const client = new LineClient(cfg);
  const today = todayJst();
  const [{ data: templates }, { data: users }] = await Promise.all([
    admin.from("message_templates").select("kind, body").in("kind", ["confirm", "reminder"]),
    admin.from("app_users").select("id, name, line_user_id").eq("is_active", true).not("line_user_id", "is", null),
  ]);
  const tpl = (k: string) => templates?.find((t) => t.kind === k)?.body ?? "";
  const team = (actor: string | null) => (users ?? []).filter((u) => u.id !== actor).map((u) => u.line_user_id!);

  for (const row of rows) {
    let out: Outcome;
    try {
      out = await process(row);
    } catch (e) {
      if (e instanceof LineApiError && e.retryable && row.attempts < 4) out = { status: "pending", note: e.message };
      else out = { status: "failed", note: e instanceof LineApiError ? (e.status === 400 ? "届けられませんでした（LINE のブロックなど）" : e.message) : "送れませんでした" };
    }
    await admin
      .from("line_outbox")
      .update({ status: out.status, note: out.note, attempts: row.attempts + 1, sent_at: out.status === "sent" ? new Date().toISOString() : null })
      .eq("id", row.id);
    if (out.status === "sent") result.sent++;
    else if (out.status === "skipped") result.skipped++;
    else if (out.status === "failed") result.failed++;
  }
  return result;

  async function loadAssignment(id: string) {
    const { data } = await admin
      .from("assignments")
      .select(
        "id, status, role_id, event_id, confirm_notice_sent_at, reminder_sent_at, role:roles(name), staff:staff(name, mypage_token, line_user_id), event:events(date, start_time, end_time, meeting_time, meeting_place, belongings, cancelled_at, venue:venues(name, address), client:companies(name))",
      )
      .eq("id", id)
      .maybeSingle();
    return data;
  }

  async function process(row: NonNullable<typeof rows>[number]): Promise<Outcome> {
    if (row.kind === "confirm" || row.kind === "reminder") {
      const a = await loadAssignment(row.assignment_id!);
      const ev = a?.event;
      if (!a || !ev || !a.staff) return { status: "skipped", note: "見つかりません" };
      if (a.status !== "confirmed" || ev.cancelled_at) return { status: "skipped", note: "確定ではなくなりました" };
      if (ev.date < today) return { status: "skipped", note: "過ぎた現場です" };
      if (row.kind === "confirm" && a.confirm_notice_sent_at) return { status: "skipped", note: "確定連絡はもう送ってあります" };
      if (row.kind === "reminder" && a.reminder_sent_at) return { status: "skipped", note: "前日リマインドはもう送ってあります" };
      if (!a.staff.line_user_id) return { status: "skipped", note: `${a.staff.name}さんは LINE とつながっていません` };
      const body = buildMessage(tpl(row.kind), ev, a.staff, { siteUrl: siteUrl(), roleName: a.role?.name });
      await client.push(a.staff.line_user_id, [text(body)], row.retry_key);
      await admin
        .from("assignments")
        .update(row.kind === "confirm" ? { confirm_notice_sent_at: new Date().toISOString() } : { reminder_sent_at: new Date().toISOString() })
        .eq("id", a.id);
      return { status: "sent", note: a.staff.name };
    }

    const to = team(row.actor_user_id);
    if (!to.length) return { status: "skipped", note: "社内で LINE とつながっている人がいません" };

    if (row.kind === "admin_confirm") {
      const a = await loadAssignment(row.assignment_id!);
      const ev = a?.event;
      if (!a || !ev || a.status !== "confirmed" || ev.cancelled_at) return { status: "skipped", note: "確定ではなくなりました" };
      const [{ data: req }, { count }] = await Promise.all([
        admin.from("event_requirements").select("required_count").eq("event_id", a.event_id).eq("role_id", a.role_id).maybeSingle(),
        admin.from("assignments").select("id", { count: "exact", head: true }).eq("event_id", a.event_id).eq("role_id", a.role_id).eq("status", "confirmed"),
      ]);
      const body = adminConfirmText({
        date: ev.date,
        venue: ev.venue?.name ?? "",
        client: ev.client?.name ?? "",
        role: a.role?.name ?? "",
        staffName: a.staff?.name ?? "",
        confirmed: count ?? 0,
        required: req?.required_count ?? 0,
        bySelf: row.actor_user_id == null,
      });
      await client.multicast(to, [text(body)], row.retry_key);
      return { status: "sent", note: `社内 ${to.length}人` };
    }

    if (row.kind === "admin_cancel") {
      const a = await loadAssignment(row.assignment_id!);
      const ev = a?.event;
      if (!a || !ev || (a.status !== "cancelled" && a.status !== "no_show") || ev.cancelled_at) return { status: "skipped", note: "キャンセル・当日不稼働ではなくなりました" };
      if (ev.date < today) return { status: "skipped", note: "過ぎた現場です" };
      const { data: overview } = await admin.from("event_overview").select("shortage_total").eq("id", a.event_id).maybeSingle();
      const body = adminDropText({
        date: ev.date,
        venue: ev.venue?.name ?? "",
        client: ev.client?.name ?? "",
        role: a.role?.name ?? "",
        staffName: a.staff?.name ?? "",
        status: a.status,
        shortage: overview?.shortage_total ?? 0,
      });
      await client.multicast(to, [text(body)], row.retry_key);
      return { status: "sent", note: `社内 ${to.length}人` };
    }

    // admin_events
    const { data: events } = await admin
      .from("events")
      .select("date, cancelled_at, venue:venues(name), client:companies(name), event_requirements(required_count, role:roles(name, sort_order))")
      .in("id", row.event_ids)
      .gte("date", today)
      .is("cancelled_at", null);
    if (!events?.length) return { status: "skipped", note: "これからの現場がありません" };
    const { data: actorRow } = row.actor_user_id ? await admin.from("app_users").select("name").eq("id", row.actor_user_id).maybeSingle() : { data: null };
    const actor = actorRow?.name ?? null;
    const body = adminEventsText(
      events.map((e) => ({
        date: e.date,
        venue: e.venue?.name ?? "",
        client: e.client?.name ?? "",
        requirements: [...e.event_requirements]
          .sort((x, y) => (x.role?.sort_order ?? 0) - (y.role?.sort_order ?? 0))
          .map((r) => ({ role: r.role?.name ?? "", count: r.required_count })),
      })),
      actor,
    );
    await client.multicast(to, [text(body)], row.retry_key);
    return { status: "sent", note: `社内 ${to.length}人` };
  }
}

let botCache: { basicId: string; displayName: string; at: number } | null = null;

/** 公式アカウントの @ID（友だち追加・コードを送るリンクに使う）。1時間覚えておく */
export async function lineBot(): Promise<{ basicId: string; displayName: string } | null> {
  const cfg = lineConfig();
  if (!cfg) return null;
  if (botCache && Date.now() - botCache.at < 3600_000) return botCache;
  try {
    const info = await new LineClient(cfg).botInfo();
    if (!info.basicId) return null;
    botCache = { ...info, at: Date.now() };
    return botCache;
  } catch {
    return null;
  }
}
