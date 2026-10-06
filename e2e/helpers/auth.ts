import { expect, type Page } from "@playwright/test";

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

/** ローカルの Supabase のメール受信箱（Mailpit）から、最新のログイン用リンクを取り出す */
async function latestLoginLink(email: string, since: number): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const data = (await res.json()) as { messages: { ID: string; Created: string }[] };
    const msg = data.messages.find((m) => new Date(m.Created).getTime() >= since - 2000);
    if (msg) {
      const detail = (await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()) as { HTML: string };
      const href = /href="([^"]*\/auth\/confirm[^"]*)"/.exec(detail.HTML)?.[1];
      if (href) return href.replaceAll("&amp;", "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${email} 宛てのログイン用メールが見つかりません`);
}

/** メールのログイン用リンクでログインする（本番と同じ流れ） */
export async function loginWithMagicLink(page: Page, email: string) {
  const since = Date.now();
  await page.goto("/login");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByRole("button", { name: "ログイン用のリンクを受け取る" }).click();
  await expect(page.getByRole("status")).toContainText("送りました");
  const link = await latestLoginLink(email, since);
  // メール内のリンクは Supabase の Site URL（localhost:3000）基準なので、テスト中の URL に合わせる
  const url = new URL(link);
  await page.goto(url.pathname + url.search);
  await expect(page).toHaveURL(/\/$/);
}
