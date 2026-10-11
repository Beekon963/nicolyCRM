import { describe, expect, it } from "vitest";
import { type AiMessage, KEEP_MESSAGES, trimHistory } from "./history";

const img = { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: "AAAA" } };

describe("送る会話を短くする", () => {
  it("短い会話はそのまま", () => {
    const ms: AiMessage[] = [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }];
    expect(trimHistory(ms)).toEqual(ms);
  });

  it("長い会話は古い分を落とし、利用者の発言から始める（道具の結果の途中から始めない）", () => {
    const ms: AiMessage[] = [];
    for (let i = 0; i < 30; i++) {
      ms.push({ role: "user", content: `質問${i}` });
      ms.push({ role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: "search", input: {} }] });
      ms.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: "{}" }] });
      ms.push({ role: "assistant", content: `答え${i}` });
    }
    ms.push({ role: "user", content: "最後" });
    const out = trimHistory(ms);
    expect(out.length).toBeLessThanOrEqual(KEEP_MESSAGES);
    expect(out[0].role).toBe("user");
    expect(typeof out[0].content).toBe("string");
    expect(out.at(-1)).toEqual({ role: "user", content: "最後" });
  });

  it("画像は新しい2回分だけ残す", () => {
    const ms: AiMessage[] = [
      { role: "user", content: [img, { type: "text", text: "1" }] },
      { role: "assistant", content: "a" },
      { role: "user", content: [img, { type: "text", text: "2" }] },
      { role: "assistant", content: "b" },
      { role: "user", content: [img, { type: "text", text: "3" }] },
    ];
    const out = trimHistory(ms);
    const kinds = out.filter((m) => m.role === "user").map((m) => (m.content as { type: string }[])[0].type);
    expect(kinds).toEqual(["text", "image", "image"]);
  });
});
