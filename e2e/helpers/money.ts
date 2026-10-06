import type { Page } from "@playwright/test";
import { SENTINELS } from "../../scripts/seed/constants.mts";

/** 管理者に見えてはいけない金額・口座の目印（seed に入れてある値） */
export const MONEY_SENTINELS = Object.values(SENTINELS).map(String);

/**
 * ページが受け取ったすべての通信（HTML・画面データ・Server Action の応答）を記録する。
 * 目印の金額が1つでも含まれていたら漏れている。
 */
export function recordResponses(page: Page) {
  const bodies: { url: string; body: string }[] = [];
  page.on("response", async (res) => {
    const type = res.headers()["content-type"] ?? "";
    if (!/text|json|javascript|x-component/.test(type)) return;
    try {
      bodies.push({ url: res.url(), body: await res.text() });
    } catch {
      // リダイレクトなど本文がない応答
    }
  });
  return {
    leaks() {
      return bodies.flatMap(({ url, body }) =>
        MONEY_SENTINELS.filter((s) => body.includes(s) || body.includes(Number(s).toLocaleString("ja-JP"))).map((s) => `${s} が ${url} に含まれている`),
      );
    },
    count: () => bodies.length,
  };
}
