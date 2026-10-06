import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { supabaseUrl } from "./env";

/**
 * 秘密キーで接続する（RLS を無視する）。用途は利用者の招待・無効化だけ（docs/design/security.md）。
 * データの読み書きには使わないこと。
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY が設定されていません（.env.example 参照）");
  return createClient<Database>(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
