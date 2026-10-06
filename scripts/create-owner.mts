/**
 * 最初のオーナーアカウントを作る（docs/setup.md ⑥）。
 *
 *   node --env-file=.env.production.local scripts/create-owner.mts you@example.com "森部 太陽"
 *
 * - 必要な環境変数: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY
 * - すでにそのメールアドレスのユーザーがいれば、オーナーとして登録し直す。
 * - 作成後は Google アカウント（同じメールアドレス）か、ログイン画面のメールのリンクでログインできる。
 */
import { createClient } from "@supabase/supabase-js";

const [email, name] = process.argv.slice(2);
if (!email || !name) {
  console.error('使い方: node --env-file=.env.local scripts/create-owner.mts メールアドレス "名前"');
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error("NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SECRET_KEY を環境変数（--env-file）で渡してください");
  process.exit(1);
}

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

let userId: string | undefined;
const created = await admin.auth.admin.createUser({ email, email_confirm: true });
if (created.data.user) userId = created.data.user.id;
else {
  // すでにいる場合は探す
  for (let page = 1; !userId && page < 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    userId = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
    if (data.users.length < 100) break;
  }
}
if (!userId) {
  console.error("ユーザーを作れませんでした:", created.error?.message);
  process.exit(1);
}

const { error } = await admin.from("app_users").upsert({ id: userId, name, email, role: "owner", is_active: true });
if (error) {
  console.error("オーナーとして登録できませんでした:", error.message);
  process.exit(1);
}
console.log(`${name}（${email}）をオーナーとして登録しました。ログイン画面から Google かメールのリンクでログインしてください。`);
