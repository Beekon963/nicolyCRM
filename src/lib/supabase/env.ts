/** Supabase の接続先（.env.local / Vercel の環境変数） */
export function supabaseUrl(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!v) throw new Error("NEXT_PUBLIC_SUPABASE_URL が設定されていません（.env.example 参照）");
  return v;
}

export function supabasePublishableKey(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!v) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY が設定されていません（.env.example 参照）");
  return v;
}

/**
 * アプリの公開URL（マイページURLの組み立てに使う。サーバー側だけで呼ぶ）。
 * NEXT_PUBLIC_SITE_URL がなければ、Vercel が自動で入れる本番のドメインを使う。
 */
export function siteUrl(): string {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return (process.env.NEXT_PUBLIC_SITE_URL || (vercel ? `https://${vercel}` : "http://localhost:3000")).replace(/\/$/, "");
}
