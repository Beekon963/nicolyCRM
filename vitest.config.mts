import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 本番サーバー（Vercel / Supabase）と同じく UTC で動かし、日本時間とのずれを検出する
process.env.TZ = "UTC";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
  },
});
