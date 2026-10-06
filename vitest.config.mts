import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 本番サーバー（Vercel / Supabase）と同じく UTC で動かし、日本時間とのずれを検出する
process.env.TZ = "UTC";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  // server-only は Next.js の外では import できないので空のモジュールにする
  "server-only": fileURLToPath(new URL("./vitest.server-only.ts", import.meta.url)),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx", "scripts/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        // ローカルの Supabase が必要（npm run db:start → npm run db:reset）
        resolve: { alias },
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
