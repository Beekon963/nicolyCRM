import { defineConfig, devices } from "@playwright/test";

/**
 * 画面テスト。ローカルの Supabase（npm run db:start → npm run db:reset）が必要。
 * スマホ幅 375px と PC の両方で動かす（要件 §6）。
 */
const PORT = Number(process.env.PORT ?? 3000);

const mobile = { ...devices["iPhone SE"], viewport: { width: 375, height: 667 }, defaultBrowserType: "chromium" as const };
const desktop = { ...devices["Desktop Chrome"] };

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "public-mobile", testMatch: /public\/.*\.spec\.ts/, use: mobile },
    { name: "public-desktop", testMatch: /public\/.*\.spec\.ts/, use: desktop },
    { name: "owner-mobile", testMatch: /owner\/.*\.spec\.ts/, use: { ...mobile, storageState: "e2e/.auth/owner.json" }, dependencies: ["setup"] },
    { name: "owner-desktop", testMatch: /owner\/.*\.spec\.ts/, use: { ...desktop, storageState: "e2e/.auth/owner.json" }, dependencies: ["setup"] },
    { name: "manager-mobile", testMatch: /manager\/.*\.spec\.ts/, use: { ...mobile, storageState: "e2e/.auth/manager.json" }, dependencies: ["setup"] },
    { name: "manager-desktop", testMatch: /manager\/.*\.spec\.ts/, use: { ...desktop, storageState: "e2e/.auth/manager.json" }, dependencies: ["setup"] },
    // キャンセルのポップアップはほかのテストの画面にも出るので、ほかが終わってから動かす
    {
      name: "alerts",
      testMatch: /alerts\/.*\.spec\.ts/,
      use: { ...mobile, storageState: "e2e/.auth/manager.json" },
      dependencies: ["owner-mobile", "owner-desktop", "manager-mobile", "manager-desktop"],
    },
  ],
  webServer: [
    // AI アシスタントは本物の AI を使わず、偽の Anthropic（e2e/mock-anthropic.mjs）に聞く
    { command: "node e2e/mock-anthropic.mjs", url: "http://127.0.0.1:4010/health", reuseExistingServer: true },
    // LINE のお知らせは本物に送らず、偽の LINE（e2e/mock-line.mjs）に送る
    { command: "node e2e/mock-line.mjs", url: "http://127.0.0.1:4011/health", reuseExistingServer: true },
    {
      command: `npm run build && npm run start:e2e -- --port ${PORT}`,
      url: `http://localhost:${PORT}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
    },
  ],
});
