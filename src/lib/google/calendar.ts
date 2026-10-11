import "server-only";
import { SheetError } from "./sheets";

/**
 * Google カレンダー（研修の予約の連携。Phase 4-3）。シートへの書き出しと同じサービスアカウントを使う。
 * オーナーのカレンダーの「共有」に、サービスアカウントのメールアドレスを「予定の変更」で足しておく。
 * - busy: その間の予定（空き時間を出すため）。この CRM が入れた予約の予定と「予定なし」にした予定は除く
 * - insert / remove: 予約が入ったら予定を入れ、キャンセルされたら消す
 */

const API = "https://www.googleapis.com/calendar/v3/calendars";

export type CalendarEventInput = { summary: string; description: string; start: Date; end: Date; bookingId: string };

export class CalendarClient {
  constructor(
    private token: string,
    private calendarId: string,
    private serviceEmail: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(path: string, init: RequestInit = {}) {
    const res = await this.fetchImpl(`${API}/${encodeURIComponent(this.calendarId)}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json", ...(init.headers ?? {}) },
    });
    if (res.status === 403 || res.status === 404)
      throw new SheetError(`カレンダーを使えません。Google カレンダーの「共有」に ${this.serviceEmail} を「予定の変更」で追加し、カレンダー ID を確かめてください`);
    if (res.status === 410 && init.method === "DELETE") return {};
    if (!res.ok) throw new SheetError(`カレンダーを使えませんでした（${res.status}）`);
    return res.status === 204 ? {} : ((await res.json()) as Record<string, unknown>);
  }

  async busy(timeMin: Date, timeMax: Date): Promise<{ start: Date; end: Date }[]> {
    const q = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: "true",
      maxResults: "2500",
      fields: "items(start,end,transparency,status,extendedProperties)",
    });
    const j = (await this.call(`/events?${q}`)) as {
      items?: { start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; transparency?: string; status?: string; extendedProperties?: { private?: Record<string, string> } }[];
    };
    return (j.items ?? [])
      .filter((e) => e.status !== "cancelled" && e.transparency !== "transparent" && !e.extendedProperties?.private?.nicolyBooking)
      .map((e) => ({
        // 終日の予定は日本時間の0時〜翌0時として扱う
        start: new Date(e.start?.dateTime ?? `${e.start?.date}T00:00:00+09:00`),
        end: new Date(e.end?.dateTime ?? `${e.end?.date}T00:00:00+09:00`),
      }))
      .filter((b) => !Number.isNaN(b.start.getTime()) && !Number.isNaN(b.end.getTime()));
  }

  async insert(ev: CalendarEventInput): Promise<string> {
    const j = (await this.call("/events", {
      method: "POST",
      body: JSON.stringify({
        summary: ev.summary,
        description: ev.description,
        start: { dateTime: ev.start.toISOString(), timeZone: "Asia/Tokyo" },
        end: { dateTime: ev.end.toISOString(), timeZone: "Asia/Tokyo" },
        extendedProperties: { private: { nicolyBooking: ev.bookingId } },
      }),
    })) as { id?: string };
    return j.id ?? "";
  }

  async remove(eventId: string) {
    await this.call(`/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
  }
}

/** 枠が予定と重なるか（端がちょうど接しているだけなら重ならない） */
export function overlaps(slot: { start: Date; end: Date }, busy: { start: Date; end: Date }[]): boolean {
  return busy.some((b) => slot.start < b.end && b.start < slot.end);
}

/** 予約した人の「Google カレンダーに追加」リンク（API は使わない） */
export function googleCalendarAddUrl(e: { title: string; start: Date; end: Date; details: string }): string {
  const f = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const q = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates: `${f(e.start)}/${f(e.end)}`, details: e.details, ctz: "Asia/Tokyo" });
  return `https://calendar.google.com/calendar/render?${q}`;
}
