import { LineClient, lineConfig, text as textMessage } from "@/lib/line/client";
import { inboxReceivedText, LINK_FAILED_TEXT, linkedText } from "@/lib/line/messages";
import { siteUrl } from "@/lib/supabase/env";
import { extractLinkCode, verifyLineSignature } from "@/lib/line/signature";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * LINE 公式アカウントの受け口（webhook。Phase 5）。LINE の署名を確かめてから動く。
 * - つなぐコード（8文字）が送られてきたら、その人の LINE と CRM をつなぎ、返事をする
 * - ブロックされたら、つながりを外す
 * - つないだオーナー・管理者からの文（LINE で転送したもの）は受信箱（line_inbox）に入れ、画面で読み取れると返事をする（Phase 18）
 * それ以外のメッセージには何もしない（公式アカウントのチャットで人が返事できる）。
 */
type LineEvent = {
  type: string;
  replyToken?: string;
  source?: { type: string; userId?: string };
  message?: { type: string; text?: string };
};

export async function POST(req: Request) {
  const cfg = lineConfig();
  if (!cfg) return Response.json({ ok: false }, { status: 404 });
  const body = await req.text();
  if (!verifyLineSignature(body, req.headers.get("x-line-signature"), cfg.secret)) return Response.json({ ok: false }, { status: 401 });

  let events: LineEvent[] = [];
  try {
    events = (JSON.parse(body) as { events?: LineEvent[] }).events ?? [];
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const admin = createAdminClient();
  const client = new LineClient(cfg);

  for (const e of events) {
    const userId = e.source?.type === "user" ? e.source.userId : undefined;
    if (!userId) continue;
    try {
      if (e.type === "unfollow") {
        await admin.rpc("line_unlink_user", { p_line_user_id: userId });
        continue;
      }
      if (e.type !== "message" || e.message?.type !== "text" || !e.replyToken) continue;
      const code = extractLinkCode(e.message.text ?? "");
      if (!code) {
        // つないだオーナー・管理者から送られた（転送された）文は、受信箱に入れる（Phase 18。登録は画面で確かめてから）
        const text = (e.message.text ?? "").trim();
        if (!text || text.length > 10000) continue;
        const { data: user } = await admin.from("app_users").select("id").eq("line_user_id", userId).eq("is_active", true).maybeSingle();
        if (!user) continue;
        const { error } = await admin.from("line_inbox").insert({ app_user_id: user.id, text });
        if (!error) await client.reply(e.replyToken, [textMessage(inboxReceivedText(`${siteUrl()}/inbox`))]);
        continue;
      }
      const { data } = await admin.rpc("line_link_consume", { p_code: code, p_line_user_id: userId });
      const r = (data ?? {}) as { ok?: boolean; kind?: "staff" | "user"; name?: string };
      await client.reply(e.replyToken, [textMessage(r.ok && r.kind && r.name ? linkedText(r.name, r.kind) : LINK_FAILED_TEXT)]);
    } catch {
      // 1件失敗しても、ほかは続ける（LINE には 200 を返す）
    }
  }
  return Response.json({ ok: true });
}
