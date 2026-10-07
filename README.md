# NICOLY CRM

NICOLY の社内CRM（現場・アサイン・実績・営業・お金の管理）。

| ドキュメント | 内容 |
|---|---|
| [docs/requirements.md](docs/requirements.md) | 要件定義（原文） |
| [docs/phase0-questions.md](docs/phase0-questions.md) | Phase 0 の確認事項と回答 |
| [docs/design/screens.md](docs/design/screens.md) | 画面一覧・画面遷移 |
| [docs/design/database.md](docs/design/database.md) | DB スキーマ（ER図） |
| [docs/design/security.md](docs/design/security.md) | 権限と RLS の方針 |
| [docs/design/plan.md](docs/design/plan.md) | フェーズ計画 |
| [docs/setup.md](docs/setup.md) | 本番を始める手順（Supabase・GitHub・Vercel。ブラウザだけで完結） |
| [docs/manual_admin.md](docs/manual_admin.md) | 操作マニュアル（オーナー・管理者向け） |
| [docs/manual_staff.md](docs/manual_staff.md) | マイページの使い方（スタッフ向け、LINE で送れる文面） |
| [CLAUDE.md](CLAUDE.md) | 開発ルール |

## 技術構成

Next.js（App Router / TypeScript）・Tailwind CSS・shadcn/ui ／ Supabase（PostgreSQL・Auth・RLS・Storage、東京リージョン）／ Vercel（Pro、東京 hnd1）

## 開発

```bash
npm install
npm run db:start             # ローカルの Supabase（Docker が必要）
npm run db:reset             # DB とダミーデータ
npm run env:local            # .env.local を作る
npm run dev                  # http://localhost:3000
npm run check                # lint + 型チェック + 単体テスト
npm run test:db              # DB・権限のテスト
npm run test:e2e             # 画面テスト（スマホ幅 375px と PC。本番ビルドを起動してから）
```
