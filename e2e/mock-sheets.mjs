/**
 * 画面テスト用の「偽の Google スプレッドシート」（Phase 18。シートを自動で読む）。本物の Google には行かない。
 * GOOGLE_DOCS_BASE=http://127.0.0.1:4012 で起動したアプリが、リンク共有のシートを CSV で読む URL
 * （/spreadsheets/d/<id>/gviz/tq?tqx=out:csv&sheet=<タブ>）をここに取りに来る。
 * タブの中身は POST /__set { tab, csv } で入れる（テストが用意する）。ないタブは 400（本物と同じ）。
 */
import http from "node:http";

const PORT = Number(process.env.MOCK_SHEETS_PORT ?? 4012);
/** タブ名 → CSV の文字列 */
let tabs = {};

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/health") return res.end("ok");
    if (url.pathname === "/__set" && req.method === "POST") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = JSON.parse(raw);
        if (body.reset) tabs = {};
        if (body.tab) tabs[body.tab] = body.csv ?? "";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, tabs: Object.keys(tabs) }));
      });
      return;
    }
    const m = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)\/gviz\/tq$/);
    if (m && req.method === "GET") {
      const tab = url.searchParams.get("sheet") ?? "";
      if (decodeURIComponent(m[1]) === "NOT_SHARED") {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end("<html><body>login</body></html>");
      }
      if (!(tab in tabs)) {
        res.writeHead(400, { "content-type": "text/plain" });
        return res.end("Invalid query");
      }
      res.writeHead(200, { "content-type": "text/csv; charset=utf-8" });
      return res.end(tabs[tab]);
    }
    res.writeHead(404);
    res.end("Not found");
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock sheets on ${PORT}`));
