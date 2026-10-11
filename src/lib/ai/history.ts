/**
 * AI アシスタントの会話（画面で持つ分）。Claude に送る形と同じ（Phase 4-4）。
 * サーバーでも画面でも使う（server-only にしない）。
 */

export type AiBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: "image/jpeg"; data: string } }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content?: string; is_error?: boolean };
export type AiMessage = { role: "user" | "assistant"; content: string | AiBlock[] };

export const KEEP_MESSAGES = 40;
export const KEEP_IMAGE_TURNS = 2;

const isToolResultTurn = (m: AiMessage) => m.role === "user" && typeof m.content !== "string" && m.content.some((b) => b.type === "tool_result");

/**
 * 送る会話を短くする。
 * - 古いやりとりを落とす（道具のやりとりの途中では切らない＝利用者の発言から始める）
 * - 画像は新しい2回分だけ残し、それより前は「省略しました」にする（送る量と料金を減らす）
 */
export function trimHistory(ms: AiMessage[]): AiMessage[] {
  let start = Math.max(0, ms.length - KEEP_MESSAGES);
  while (start < ms.length && (ms[start].role !== "user" || isToolResultTurn(ms[start]))) start++;
  const kept = ms.slice(start);
  let imageTurns = 0;
  for (let i = kept.length - 1; i >= 0; i--) {
    const c = kept[i].content;
    if (typeof c === "string" || !c.some((b) => b.type === "image")) continue;
    if (++imageTurns > KEEP_IMAGE_TURNS) kept[i] = { ...kept[i], content: c.map((b) => (b.type === "image" ? { type: "text", text: "（前に送った画像。省略しました）" } : b)) };
  }
  return kept;
}
