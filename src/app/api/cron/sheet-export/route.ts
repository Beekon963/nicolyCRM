import { runSheetExport } from "@/lib/sheet-export";

/**
 * 稼働表のスプレッドシートへの自動書き出し（Vercel の Cron から10分ごとに呼ばれる。vercel.json）。
 * Vercel は環境変数 CRON_SECRET を「Authorization: Bearer …」で送ってくるので、それを確かめる。
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false }, { status: 401 });
  }
  const r = await runSheetExport("cron");
  return Response.json(r);
}
