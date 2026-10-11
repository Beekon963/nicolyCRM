import { enqueueReminders, flushLineOutbox } from "@/lib/line/notify";

/**
 * LINE のお知らせの定期実行（Vercel の Cron から1分ごと。vercel.json）。
 * 前日のお知らせを入れ、送れていないお知らせを送る。CRON_SECRET を確かめる。
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }
  const reminders = await enqueueReminders();
  const r = await flushLineOutbox();
  return Response.json({ ok: true, reminders, ...r });
}
