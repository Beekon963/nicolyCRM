import "server-only";
import { formatLongJa, formatShortJa, formatTimeJst, toJstDateString } from "@/lib/date";
import { CALENDAR_SCOPE, getAccessToken, readServiceAccount } from "@/lib/google/sheets";
import { CalendarClient, overlaps } from "@/lib/google/calendar";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAnonClient, createClient } from "@/lib/supabase/server";

/**
 * オンライン研修の予約（Phase 4-3）。予約の受け付けは DB の training_public_*（鍵の確認・定員）で行い、
 * ここでは Google カレンダーとの連携（空き時間で枠を絞る・予定を入れる / 消す）をする。
 * カレンダーの連携は設定があるときだけ。失敗しても予約そのものは止めない。
 */

export type TrainingSettings = { calendarId: string; defaultTitle: string; defaultUrl: string };
export const DEFAULT_TRAINING_SETTINGS: TrainingSettings = { calendarId: "", defaultTitle: "オンライン研修", defaultUrl: "" };

/** 研修の設定（settings: key = 'training'）。ログインなしの予約画面からも読むので、秘密キーで読む */
export async function getTrainingSettings(): Promise<TrainingSettings> {
  const { data } = await createAdminClient().from("settings").select("value").eq("key", "training").maybeSingle();
  const v = (data?.value ?? {}) as Partial<TrainingSettings>;
  return {
    calendarId: typeof v.calendarId === "string" ? v.calendarId : "",
    defaultTitle: typeof v.defaultTitle === "string" && v.defaultTitle ? v.defaultTitle : DEFAULT_TRAINING_SETTINGS.defaultTitle,
    defaultUrl: typeof v.defaultUrl === "string" ? v.defaultUrl : "",
  };
}

async function calendar(): Promise<CalendarClient | null> {
  const { calendarId } = await getTrainingSettings();
  const sa = readServiceAccount();
  if (!calendarId || !sa) return null;
  return new CalendarClient(await getAccessToken(sa, fetch, Date.now(), CALENDAR_SCOPE), calendarId, sa.client_email);
}

/** カレンダーとつながるか確かめる（設定の保存のとき） */
export async function checkCalendar(): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!readServiceAccount()) return { ok: false, message: "Google の設定（シートへの書き出しと同じもの）がまだないので、カレンダーとつなげません" };
  try {
    const cal = await calendar();
    if (!cal) return { ok: false, message: "カレンダー ID を入れてください" };
    const now = new Date();
    await cal.busy(now, new Date(now.getTime() + 86400_000));
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "カレンダーを読めませんでした" };
  }
}

/** 管理画面用: カレンダーの予定と重なっている枠（予約の画面に出ていない枠）。連携していなければ null */
export async function calendarConflicts(slots: { id: string; startsAt: string; endsAt: string }[]): Promise<Set<string> | null> {
  if (!slots.length) return null;
  try {
    const cal = await calendar();
    if (!cal) return null;
    const starts = slots.map((s) => new Date(s.startsAt).getTime());
    const ends = slots.map((s) => new Date(s.endsAt).getTime());
    const busy = await cal.busy(new Date(Math.min(...starts)), new Date(Math.max(...ends)));
    return new Set(slots.filter((s) => overlaps({ start: new Date(s.startsAt), end: new Date(s.endsAt) }, busy)).map((s) => s.id));
  } catch {
    return null;
  }
}

export type PublicSlot = { id: string; title: string; startsAt: string; endsAt: string; note: string; left: number };

const ERRORS: Record<string, string> = {
  invalid_token: "このリンクは使えません。新しいリンクを担当者に確認してください。",
  rate_limited: "アクセスが集中しています。少し待ってから開き直してください。",
  not_found: "予約が見つかりません。",
  closed: "この枠はもう予約できません。ほかの枠を選んでください。",
  full: "この枠は満席になりました。ほかの枠を選んでください。",
  invalid_input: "お名前を入れてください（50文字まで）。",
  cannot_cancel: "研修が始まったあと・キャンセル済みの予約は、キャンセルできません。担当者にご連絡ください。",
};
export const trainingError = (code: string) => ERRORS[code] ?? "いまは予約できません。時間をおいて開き直してください。";

/** 予約できる枠。カレンダーと連携していれば、予定と重なる枠は出さない */
export async function loadPublicSlots(token: string): Promise<{ ok: true; slots: PublicSlot[] } | { ok: false; error: string }> {
  const { data, error } = await createAnonClient().rpc("training_public_slots", { p_token: token });
  if (error || !data) return { ok: false, error: trainingError("") };
  const r = data as { error?: string; slots?: { id: string; title: string; starts_at: string; ends_at: string; note: string; left: number }[] };
  if (r.error) return { ok: false, error: trainingError(r.error) };
  let slots = (r.slots ?? []).map((s) => ({ id: s.id, title: s.title, startsAt: s.starts_at, endsAt: s.ends_at, note: s.note, left: s.left }));
  if (slots.length) {
    try {
      const cal = await calendar();
      if (cal) {
        const busy = await cal.busy(new Date(slots[0].startsAt), new Date(slots.at(-1)!.endsAt));
        slots = slots.filter((s) => !overlaps({ start: new Date(s.startsAt), end: new Date(s.endsAt) }, busy));
      }
    } catch {
      // カレンダーが読めなくても、枠は出す（二重予約は定員で防ぐ）
    }
  }
  return { ok: true, slots };
}

/** 予約が入ったらカレンダーに予定を入れる（連携しているときだけ。失敗しても予約は残す） */
export async function addBookingToCalendar(bookingId: string): Promise<void> {
  try {
    const cal = await calendar();
    if (!cal) return;
    const admin = createAdminClient();
    const { data } = await admin
      .from("training_bookings")
      .select("id, name, contact, memo, calendar_event_id, slot:training_slots(title, starts_at, ends_at, meeting_url)")
      .eq("id", bookingId)
      .maybeSingle();
    if (!data?.slot || data.calendar_event_id) return;
    const start = new Date(data.slot.starts_at);
    const eventId = await cal.insert({
      summary: `${data.slot.title}: ${data.name}`,
      description: [`お名前: ${data.name}`, data.contact && `連絡先: ${data.contact}`, data.memo && `メモ: ${data.memo}`, data.slot.meeting_url && `URL: ${data.slot.meeting_url}`, "（NICOLY CRM の予約から）"]
        .filter(Boolean)
        .join("\n"),
      start,
      end: new Date(data.slot.ends_at),
      bookingId: data.id,
    });
    if (eventId) await admin.from("training_bookings").update({ calendar_event_id: eventId }).eq("id", data.id);
  } catch {
    // カレンダーに入れられなくても予約は有効
  }
}

/** キャンセルされたらカレンダーの予定を消す */
export async function removeBookingFromCalendar(bookingId: string): Promise<void> {
  try {
    const cal = await calendar();
    if (!cal) return;
    const admin = createAdminClient();
    const { data } = await admin.from("training_bookings").select("calendar_event_id").eq("id", bookingId).maybeSingle();
    if (!data?.calendar_event_id) return;
    await cal.remove(data.calendar_event_id);
    await admin.from("training_bookings").update({ calendar_event_id: null }).eq("id", bookingId);
  } catch {
    // 消せなくても、予約の取り消しは有効
  }
}

/** 画面の表示「10/20(火) 10:00〜11:00」 */
export function slotLabel(startsAt: string, endsAt: string): string {
  const s = new Date(startsAt);
  return `${formatShortJa(toJstDateString(s))} ${formatTimeJst(s)}〜${formatTimeJst(new Date(endsAt))}`;
}

/** 日付ごとにまとめる表示用: 日付（日本時間）・「2026年10月20日(火)」・「10:00〜11:00」 */
export function slotParts(startsAt: string, endsAt: string): { date: string; day: string; time: string } {
  const s = new Date(startsAt);
  const date = toJstDateString(s);
  return { date, day: formatLongJa(date), time: `${formatTimeJst(s)}〜${formatTimeJst(new Date(endsAt))}` };
}

export type AdminSlot = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  meetingUrl: string;
  note: string;
  isActive: boolean;
  bookings: { id: string; name: string; contact: string; memo: string; source: string; cancelled: boolean; createdAt: string; cancelToken: string }[];
};

/** 管理画面の枠と予約（今日から先。past を true にすると過去60日） */
export async function loadAdminSlots(past = false): Promise<AdminSlot[]> {
  const supabase = await createClient();
  const now = new Date();
  let q = supabase
    .from("training_slots")
    .select("id, title, starts_at, ends_at, capacity, meeting_url, note, is_active, bookings:training_bookings(id, name, contact, memo, source, cancelled_at, created_at, cancel_token)")
    .order("starts_at", { ascending: !past });
  q = past ? q.lt("ends_at", now.toISOString()).gte("starts_at", new Date(now.getTime() - 60 * 86400_000).toISOString()) : q.gte("ends_at", now.toISOString());
  const { data } = await q.limit(300);
  return (data ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    startsAt: s.starts_at,
    endsAt: s.ends_at,
    capacity: s.capacity,
    meetingUrl: s.meeting_url,
    note: s.note,
    isActive: s.is_active,
    bookings: (s.bookings ?? [])
      .map((b) => ({ id: b.id, name: b.name, contact: b.contact, memo: b.memo, source: b.source, cancelled: b.cancelled_at != null, createdAt: b.created_at, cancelToken: b.cancel_token }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  }));
}
