# NICOLY 社内CRM — まず `CLAUDE.md` を読むこと

このリポジトリの開発ルール（用語・お金の扱い・日付・DB と権限・UI・コマンド・ブランチの決まり）は `CLAUDE.md` にあります。Codex など `CLAUDE.md` を自動で読まないエージェントも、作業の前に必ず読んでください。要点:

- 画面は日本語。「シフト・出勤・勤怠・給与・従業員」は使わない（稼働・稼働可能日・報酬・スタッフ）
- 金額はオーナーだけ。管理者が読めるテーブル・画面・API に金額を出さない（`tests/db/money-tables.ts`、`e2e/manager/money-leak.spec.ts` で確かめる）
- 実在の人名・会場名・電話番号・金額をテスト・文書・ダミーデータに入れない
- コミット前に `npm run check`。DB を変えるときは `supabase/migrations/` にファイルを足し、`npm run db:types` と `tests/db` も
- 本番に出すのは `main` だけ。開発ブランチからプルリクエストを出し、ユーザーが Merge する。ほかのエージェントと同時に作業するときは、ブランチと担当するファイルを分ける（担当は `docs/design/plan.md` の各フェーズの表で決める）

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
