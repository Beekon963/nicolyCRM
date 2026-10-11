/**
 * 画面テスト用の「偽の Anthropic」（Phase 4-4）。本物の AI は使わず、決めた手順で答える。
 * ANTHROPIC_BASE_URL=http://127.0.0.1:4010 で起動したアプリが、ここに聞きに来る（playwright.config.ts の webServer）。
 *
 * - 「探して:名前」→ search を使う → 結果の名前を「見つかった人: …」と答える
 * - 画像付きで「名前:〇〇」→ search → propose_availability（150日後を○）→「確認カードを出しました」
 * - 「道具」→ 渡された道具の名前を答える（管理者に金額の道具が渡っていないかの確認用）
 *
 * 本物と同じく、答えの先頭に AI の考えの記録（署名つき）を付ける。次の問い合わせでその記録が
 * そのまま返ってこないとき・設定（drop_block・fallbacks など）が違うときは、そう答える（画面テストが失敗する）。
 */
import http from "node:http";

const PORT = Number(process.env.MOCK_ANTHROPIC_PORT ?? 4010);

function jstPlusDays(days) {
  return new Date(Date.now() + 9 * 3600_000 + days * 86400_000).toISOString().slice(0, 10);
}

function textOf(content) {
  if (typeof content === "string") return content;
  return content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

let signatures = 0;

function sse(res, blocks, stopReason) {
  blocks = [{ type: "thinking" }, ...blocks];
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send("message_start", {
    message: { id: `msg_${Date.now()}`, type: "message", role: "assistant", model: "e2e-mock", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } },
  });
  blocks.forEach((b, index) => {
    if (b.type === "thinking") {
      send("content_block_start", { index, content_block: { type: "thinking", thinking: "", signature: "" } });
      send("content_block_delta", { index, delta: { type: "signature_delta", signature: `sig-mock-${++signatures}` } });
    } else if (b.type === "text") {
      send("content_block_start", { index, content_block: { type: "text", text: "" } });
      // 少しずつ送る（画面で途中経過が出ることを確かめる）
      for (const part of b.text.match(/.{1,8}/gsu) ?? []) send("content_block_delta", { index, delta: { type: "text_delta", text: part } });
    } else {
      send("content_block_start", { index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
      send("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
    }
    send("content_block_stop", { index });
  });
  send("message_delta", { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 1 } });
  send("message_stop", {});
  res.end();
}

const text = (res, t) => sse(res, [{ type: "text", text: t }], "end_turn");
const tool = (res, name, input) => sse(res, [{ type: "tool_use", id: `toolu_${Date.now()}`, name, input }], "tool_use");

/** アプリの設定が本物の AI に送るとおりになっているか（違えば理由） */
function settingsProblem(body, betaHeader) {
  if (body.thinking?.type !== "adaptive" || body.thinking?.block_binding?.prefix_mismatch_behavior !== "drop_block") return "thinking";
  if (body.fallbacks !== "default") return "fallbacks";
  for (const b of ["thinking-binding-controls-2026-08-01", "server-side-fallback-2026-07-01"]) if (!String(betaHeader ?? "").includes(b)) return `beta ${b}`;
  // 前の答えの考えの記録が、そのまま返ってきているか
  for (const m of body.messages)
    // （アプリが「ここで止めました」を足した答えは、AI からのものではないので除く）
    if (m.role === "assistant" && Array.isArray(m.content) && !(m.content.length === 1 && m.content[0].type === "text") && !(m.content[0]?.type === "thinking" && /^sig-mock-\d+$/.test(m.content[0]?.signature ?? ""))) return "THINKING_LOST";
  return null;
}

function reply(body, res, betaHeader) {
  const problem = settingsProblem(body, betaHeader);
  if (problem) return text(res, `設定がちがいます: ${problem}`);
  const ms = body.messages;
  const last = ms.at(-1);
  const results = Array.isArray(last.content) ? last.content.filter((b) => b.type === "tool_result") : [];
  // 利用者の最後の発言（道具の結果ではないもの）
  const userTurn = [...ms].reverse().find((m) => m.role === "user" && !(Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result")));
  const hasImage = Array.isArray(userTurn.content) && userTurn.content.some((b) => b.type === "image");

  if (results.length) {
    const used = ms.at(-2).content.filter((b) => b.type === "tool_use").at(-1)?.name;
    const r = results[0];
    if (r.is_error) return text(res, `うまくいきませんでした: ${r.content}`);
    if (used === "search") {
      const staff = JSON.parse(r.content).staff ?? [];
      if (!staff.length) return text(res, "見つかりませんでした");
      if (hasImage) return tool(res, "propose_availability", { entries: [{ staff_id: staff[0].staff_id, days: [{ date: jstPlusDays(150), status: "ok" }] }] });
      return text(res, `見つかった人: ${staff.map((s) => s.name).join("、")}`);
    }
    if (used?.startsWith("propose_")) return text(res, "確認カードを出しました。内容を確かめて「登録する」を押してください。");
    return text(res, "わかりました");
  }

  const q = textOf(userTurn.content);
  if (q.includes("道具")) return text(res, `道具: ${(body.tools ?? []).map((t) => t.name).join(",")}`);
  const name = q.match(/(?:探して|名前)[:：]\s*(.+)/)?.[1]?.trim();
  if (name) return tool(res, "search", { q: name });
  return text(res, "こんにちは。何をお手伝いしましょうか。");
}

http
  .createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") return res.end("ok");
    if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) {
      res.writeHead(404);
      return res.end();
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        reply(JSON.parse(raw), res, req.headers["anthropic-beta"]);
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: String(e) } }));
      }
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock anthropic on ${PORT}`));
