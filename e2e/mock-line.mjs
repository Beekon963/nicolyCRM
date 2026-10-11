/**
 * 画面テスト用の「偽の LINE」（Phase 5）。本物の LINE には送らない。
 * LINE_API_BASE=http://127.0.0.1:4011 で起動したアプリが、ここに送る（playwright.config.ts の webServer）。
 * 受け取ったもの（送り先・文）を覚えておき、GET /__sent で返す。
 */
import http from "node:http";

const PORT = Number(process.env.MOCK_LINE_PORT ?? 4011);
let sent = [];

http
  .createServer((req, res) => {
    const json = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/health") return res.end("ok");
    if (req.url === "/__sent" && req.method === "GET") return json(200, sent);
    if (req.url === "/v2/bot/info" && req.method === "GET") return json(200, { userId: "Ubot", basicId: "@nicoly-e2e", displayName: "NICOLY テスト" });
    if (req.method === "POST" && req.url?.startsWith("/v2/bot/message/")) {
      if (req.headers.authorization !== "Bearer e2e-line") return json(401, { message: "Authentication failed" });
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw);
        const key = req.headers["x-line-retry-key"];
        // 同じ再送の鍵は二重に受け付けない（本物と同じ）
        if (key && sent.some((s) => s.retryKey === key)) return json(409, { message: "The retry key is already accepted" });
        sent.push({ path: req.url, to: body.to ?? null, replyToken: body.replyToken ?? null, text: body.messages?.map((m) => m.text).join("\n") ?? "", retryKey: key ?? null });
        json(200, {});
      });
      return;
    }
    json(404, { message: "Not found" });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock line on ${PORT}`));
