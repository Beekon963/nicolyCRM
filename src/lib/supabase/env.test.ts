import { afterEach, describe, expect, it, vi } from "vitest";
import { siteUrl } from "./env";

describe("siteUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("NEXT_PUBLIC_SITE_URL を優先し、末尾の / は外す", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://crm.example.com/");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "nicoly-crm.vercel.app");
    expect(siteUrl()).toBe("https://crm.example.com");
  });

  it("なければ Vercel の本番ドメインを使う", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "nicoly-crm.vercel.app");
    expect(siteUrl()).toBe("https://nicoly-crm.vercel.app");
  });

  it("どちらもなければ手元の開発用", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect(siteUrl()).toBe("http://localhost:3000");
  });
});
