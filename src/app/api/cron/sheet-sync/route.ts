import { runSheetSync } from "@/lib/sheet-sync";

/**
 * 管理用スプレッドシートの自動の読み取り（Vercel の Cron から10分ごとに呼ばれる。vercel.json。Phase 18）。
 * Vercel は環境変数 CRON_SECRET を「Authorization: Bearer …」で送ってくるので、それを確かめる。
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }
  const r = await runSheetSync("cron");
  return Response.json({ ok: r.ok, message: r.message });
}
