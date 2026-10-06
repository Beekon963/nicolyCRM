import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./database.types";
import { supabasePublishableKey, supabaseUrl } from "./env";

/**
 * ログイン中の利用者として DB にアクセスする（RLS が効く）。
 * Server Component / Server Action / Route Handler から使う。
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component からは書き込めない。セッションの更新は proxy が行う
        }
      },
    },
  });
}

/** マイページ用: ログインなし（anon）で、トークンを検証する DB 関数だけを呼ぶ */
export function createAnonClient() {
  return createServerClient<Database>(supabaseUrl(), supabasePublishableKey(), {
    cookies: { getAll: () => [], setAll: () => {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
