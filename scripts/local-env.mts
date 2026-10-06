/**
 * ローカルの Supabase（npm run db:start）につなぐ .env.local を作る。
 *   npm run env:local
 */
import { execSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const out = execSync("npx supabase status -o json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const s = JSON.parse(out.slice(out.indexOf("{")));
if (existsSync(".env.local") && !process.argv.includes("--force")) {
  console.log(".env.local はすでにあります。作り直すときは npm run env:local -- --force");
  process.exit(0);
}
writeFileSync(
  ".env.local",
  [
    "# ローカルの Supabase 用（npm run env:local で作成）",
    `NEXT_PUBLIC_SUPABASE_URL=${s.API_URL}`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${s.PUBLISHABLE_KEY}`,
    `SUPABASE_SECRET_KEY=${s.SECRET_KEY}`,
    "NEXT_PUBLIC_SITE_URL=http://localhost:3000",
    "",
  ].join("\n"),
);
console.log(".env.local を作りました");
