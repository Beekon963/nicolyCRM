import { runSheetWriteback } from "@/lib/sheet-writeback";

/**
 * CRM で入れたものをシートにも書く（書き戻し。Vercel の Cron から2分ごと。vercel.json。Phase 19）。
 * Vercel は環境変数 CRON_SECRET を「Authorization: Bearer …」で送ってくるので、それを確かめる。
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }
  const r = await runSheetWriteback("cron");
  return Response.json(r);
}
