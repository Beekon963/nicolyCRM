# セットアップ手順（Supabase・Vercel）

コマンドはそのままコピーして貼り付ければ動くように書いています。`（ ）` の部分だけご自身の値に置き換えてください。

## いつ何をやるか

| タイミング | やること | 所要時間の目安 |
|---|---|---|
| **いま（Phase 0 の承認と一緒に）** | ① Supabase の開発用プロジェクト ② Google ログインの準備 ③ メール送信の準備 | 30〜40分 |
| Phase 1 の最後（本番デプロイ前） | ④ Supabase の本番用プロジェクト（Pro）⑤ Vercel（Pro）⑥ 最初のオーナーアカウント | 30分 |

キーやパスワードは**チャットやリポジトリに貼らず**、Supabase・Vercel の画面に直接入力してください。こちらで必要な値は、その都度お知らせします。

---

## ① Supabase の開発用プロジェクト（無料）

1. https://supabase.com/dashboard を開き、GitHub アカウントなどでサインアップ
2. **組織（Organization）を作る**: 名前 `NICOLY 開発`、プラン **Free**
   - 本番用（Pro）とは**別の組織**にします。Pro の組織に開発用プロジェクトを作ると、その分の料金が追加でかかるためです。
3. **New project**
   - Name: `nicoly-crm-dev`
   - Database Password: 「Generate a password」で作り、パスワード管理アプリなどに保存
   - Region: **Northeast Asia (Tokyo)**
4. 作成後、左メニュー **Authentication → Sign In / Providers**
   - **Allow new users to sign up** を **オフ**（招待制にするため）
   - **Email** は有効のまま
5. **Authentication → URL Configuration**
   - Site URL: `http://localhost:3000`
   - Redirect URLs に追加: `http://localhost:3000/auth/callback`
6. **Authentication → Emails → Templates → Magic Link** を ④ の 4 と同じように変更する
7. **Project Settings → API Keys** で次の3つを控える（あとで `.env.local` と Vercel に入れます）
   - Project URL（`https://（英数字）.supabase.co`）
   - Publishable key（`sb_publishable_` で始まる）
   - Secret key（`sb_secret_` で始まる。**秘密**。人に送らない）

## ② Google ログインの準備

1. https://console.cloud.google.com/ を開き、上部のプロジェクト選択 →「新しいプロジェクト」→ 名前 `nicoly-crm`
2. 左メニュー **APIとサービス → OAuth 同意画面**（「Google Auth Platform」と表示される場合もあります）
   - アプリ名: `NICOLY CRM`、サポートメール: ご自身のアドレス
   - 対象: **外部**
   - 公開ステータスは「本番環境」に変更（メール・名前だけを使うので Google の審査は不要です）
3. **認証情報（クライアント）→ 認証情報を作成 → OAuth クライアント ID**
   - アプリケーションの種類: **ウェブ アプリケーション**
   - 承認済みのリダイレクト URI: `https://（SupabaseのProject URLの英数字部分）.supabase.co/auth/v1/callback`
4. 表示された **クライアント ID** と **クライアント シークレット** を、Supabase の **Authentication → Sign In / Providers → Google** に貼り付けて有効化

本番用プロジェクトを作ったら、同じ Google の OAuth クライアントに本番用のリダイレクト URI も追加します（④で案内します）。

## ③ メール送信の準備（招待メール・ログインリンク用）

Supabase 標準のメール送信は「プロジェクトのメンバー宛てにしか送れない・1時間に2通まで」の制限があり、実運用では使えません。次のどちらかを設定します（どちらも無料の範囲で足ります）。

| | A. 会社のドメインがある（例: `@nicoly.co.jp`） | B. ドメインがない |
|---|---|---|
| サービス | Resend（無料: 月3,000通） | Gmail（アプリパスワード） |
| 準備 | Resend に登録 → ドメインを追加し、表示される DNS 設定をドメイン管理画面に追加 → SMTP 用の API キーを作成 | 送信用の Gmail で2段階認証をオン → https://myaccount.google.com/apppasswords でアプリパスワードを作成 |
| Supabase の設定（**Authentication → Emails → SMTP Settings**） | Host `smtp.resend.com` / Port `465` / User `resend` / Password（API キー）/ 送信元 `noreply@（ドメイン）` | Host `smtp.gmail.com` / Port `465` / User（Gmail アドレス）/ Password（アプリパスワード）/ 送信元（同じ Gmail アドレス） |

> ログインは Google アカウントだけでもできます。全員が Google アカウントでログインするなら③は後回しでも構いません（ただし招待メールの送信には③が必要です）。

---

## ④ Supabase の本番用プロジェクト（Pro）

1. 新しい組織: 名前 `NICOLY`、プラン **Pro**（月 $25。日次バックアップ付き）
2. New project: Name `nicoly-crm`、Region **Northeast Asia (Tokyo)**
3. ①の 4〜6、②の 3〜4、③ と同じ設定をする。ただし URL は本番のもの
   - Site URL: `https://（Vercel の URL）`
   - Redirect URLs: `https://（Vercel の URL）/auth/callback`
   - Google の OAuth クライアントに `https://（本番の英数字）.supabase.co/auth/v1/callback` を追加
4. **Authentication → Emails → Templates → Magic Link** を次のように変更（ログイン用メールを日本語にし、別の端末で開いてもログインできるリンクにする）
   - Subject: `NICOLY CRM ログイン用リンク`
   - Message body: リポジトリの `supabase/templates/magic_link.html` の中身をそのまま貼り付け
5. DB を作る（パソコンのターミナルで、このリポジトリのフォルダから）

```bash
npx supabase login
npx supabase link --project-ref （本番の英数字）
npx supabase db push
```

> 開発用プロジェクト（①）にも同じ手順で DB を作れます。開発用にだけダミーデータを入れる場合は、
> `npx supabase link --project-ref （開発用の英数字）` のあとに
> `npm run db:seed:generate && npx supabase db reset --linked` を実行します（**本番では絶対に実行しないでください。データが消えます**）。

## ⑤ Vercel（Pro）

1. https://vercel.com/ に GitHub アカウントでサインアップし、**Pro** プランのチームを作る（月 $20。商用利用は Pro が必要）
2. **Add New… → Project → Import Git Repository** で `Beekon963/nicolyCRM` を選ぶ
3. **Environment Variables** に次を入れる

| 名前 | 値 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 本番の Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 本番の Publishable key |
| `SUPABASE_SECRET_KEY` | 本番の Secret key |
| `NEXT_PUBLIC_SITE_URL` | `https://（Vercel の URL）`（最初は空でデプロイし、URL が決まったら入れて再デプロイ） |

4. **Deploy**。関数のリージョンはリポジトリの `vercel.json` で東京（`hnd1`）に固定済みです。

## ⑥ 最初のオーナーアカウント

パソコンのターミナルで、このリポジトリのフォルダから実行します。

1. 本番の接続先を書いたファイル `.env.production.local` を作る（コミットされません）

```bash
cat > .env.production.local <<'ENV'
NEXT_PUBLIC_SUPABASE_URL=https://（本番の英数字）.supabase.co
SUPABASE_SECRET_KEY=（本番の Secret key）
ENV
```

2. オーナーを登録する（メールアドレスは Google アカウントのアドレス）

```bash
node --env-file=.env.production.local scripts/create-owner.mts （メールアドレス） "森部 太陽"
```

3. アプリの URL を開き、「Google でログイン」でログインできれば完了です。以降の管理者の招待は、アプリの「設定 → ユーザー」から行えます。

---

## 開発用パソコンでの起動（必要な場合だけ）

普段の開発はこちらで行うため、必須ではありません。手元で動かしたい場合:

```bash
git clone https://github.com/Beekon963/nicolyCRM.git
cd nicolyCRM
npm install
npm run db:start      # ローカルの Supabase を起動（Docker Desktop が必要）
npm run db:reset      # DB を作ってダミーデータを入れる
npm run env:local     # .env.local を作る
npm run dev           # http://localhost:3000 を開く
```

- Node.js 22.18 以上が必要です。
- ダミーデータのログイン: `owner@example.com`（オーナー）/ `manager@example.com`（管理者）。ログイン画面でメールのリンクを受け取り、http://127.0.0.1:54324 （ローカルのメール受信箱）でリンクを開きます。
- テスト: `npm run check`（単体）、`npm run test:db`（DB・権限）、`npm run test:e2e`（画面。本番ビルドで動かす）

## 月額の目安

| サービス | プラン | 月額 |
|---|---|---|
| Vercel | Pro | 約 $20 |
| Supabase（本番） | Pro | 約 $25 |
| Supabase（開発） | Free | 0円 |
| メール送信（Resend / Gmail） | 無料枠 | 0円 |
| 合計 | | 約 $45（7,000円前後） |
