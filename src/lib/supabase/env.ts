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

/** アプリの公開URL（マイページURL・メール内リンクの組み立てに使う） */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");
}
