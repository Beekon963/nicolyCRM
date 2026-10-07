# セットアップ手順（本番を始める）

**ブラウザの操作だけで完結します**（パソコンでコマンドを打つ必要はありません）。

- キーやパスワードは**チャットやリポジトリに貼らず**、Supabase・GitHub・Vercel の画面に直接入力してください。
- `（ ）` の部分はご自身の値に置き換えてください。

## 全体の流れ

| 順番 | やること | 目安 |
|---|---|---|
| ① | Supabase の本番プロジェクトを作る | 10分 |
| ② | Google ログインの準備（おすすめ） | 10分 |
| ③ | メール送信の準備（管理者を招待するときに必要） | 10分 |
| ④ | GitHub: 本番用の `main` と、合言葉（Secrets）の登録 | 10分 |
| ⑤ | データベースを作る（GitHub のボタン） | 5分 |
| ⑥ | Vercel でアプリを公開する | 10分 |
| ⑦ | 最初のオーナーを登録する（GitHub のボタン） | 3分 |
| ⑧ | ログインして名簿を取り込む | 10分 |

②・③ は後回しにもできます。そのときは、⑦で **Supabase に登録したのと同じメールアドレス** をオーナーにすれば、ログイン画面の「ログイン用のリンクを受け取る」でログインできます。Supabase 標準のメールは、Supabase の組織のメンバー宛てにだけ、1時間に数通まで送れます。

---

## ① Supabase の本番プロジェクト（Pro）

1. https://supabase.com/dashboard/organizations で組織を作る（すでにあればそれを使う）
   - 名前 `NICOLY`、プラン **Pro**（月 $25。日次バックアップ付き）
2. **New project**
   - Name: `nicoly-crm`
   - Database Password: 「Generate a password」で作り、**パスワード管理アプリなどに保存**（④で使います）
   - Region: **Northeast Asia (Tokyo)**
3. 左メニュー **Authentication → Sign In / Providers**
   - **Allow new users to sign up** を **オフ**（招待制にするため）
   - **Email** は有効のまま
4. **Authentication → URL Configuration**
   - Site URL: `https://nicoly-crm.vercel.app`
   - Redirect URLs に追加: `https://nicoly-crm.vercel.app/auth/callback`
   - ⑥ で URL が違うものになった場合は、ここを書き換えます
5. **Authentication → Emails → Templates → Magic Link**（ログイン用メールを日本語にし、別の端末で開いてもログインできるリンクにする）
   - Subject: `NICOLY CRM ログイン用リンク`
   - Message body: GitHub のリポジトリで `supabase/templates/magic_link.html` を開き、右上のコピーボタンでコピーして貼り付け
6. 次の値を控える（④・⑥ で使います）

| 値 | 場所 |
|---|---|
| プロジェクトの英数字（Project ID） | **Project Settings → General** |
| Project URL | `https://（プロジェクトの英数字）.supabase.co` |
| Publishable key（`sb_publishable_` で始まる） | **Project Settings → API Keys** |
| Secret key（`sb_secret_` で始まる。**秘密**） | **Project Settings → API Keys** |
| データベースのパスワード | 2 で保存したもの（忘れたら **Project Settings → Database → Reset database password**） |

7. アクセストークンを作る: https://supabase.com/dashboard/account/tokens → **Generate new token** → 名前 `github`
   - 表示された `sbp_` で始まる値を控えます（一度しか表示されません。**秘密**）

## ② Google ログインの準備（おすすめ）

1. https://console.cloud.google.com/ を開き、上部のプロジェクト選択 →「新しいプロジェクト」→ 名前 `nicoly-crm`
2. 左メニュー **APIとサービス → OAuth 同意画面**（「Google Auth Platform」と表示される場合もあります）
   - アプリ名: `NICOLY CRM`、サポートメール: ご自身のアドレス
   - 対象: **外部**
   - 公開ステータスは「本番環境」に変更（メール・名前だけを使うので Google の審査は不要です）
3. **認証情報（クライアント）→ 認証情報を作成 → OAuth クライアント ID**
   - アプリケーションの種類: **ウェブ アプリケーション**
   - 承認済みのリダイレクト URI: `https://（プロジェクトの英数字）.supabase.co/auth/v1/callback`
4. 表示された **クライアント ID** と **クライアント シークレット** を、Supabase の **Authentication → Sign In / Providers → Google** に貼り付けて有効化

## ③ メール送信の準備（招待メール・ログインリンク用）

Supabase 標準のメール送信は「組織のメンバー宛てにしか送れない・1時間に数通まで」の制限があり、管理者の招待には使えません。次のどちらかを設定します（どちらも無料の範囲で足ります）。

| | A. 会社のドメインがある（例: `@nicoly.co.jp`） | B. ドメインがない |
|---|---|---|
| サービス | Resend（無料: 月3,000通） | Gmail（アプリパスワード） |
| 準備 | Resend に登録 → ドメインを追加し、表示される DNS 設定をドメイン管理画面に追加 → SMTP 用の API キーを作成 | 送信用の Gmail で2段階認証をオン → https://myaccount.google.com/apppasswords でアプリパスワードを作成 |
| Supabase の設定（**Authentication → Emails → SMTP Settings**） | Host `smtp.resend.com` / Port `465` / User `resend` / Password（API キー）/ 送信元 `noreply@（ドメイン）` | Host `smtp.gmail.com` / Port `465` / User（Gmail アドレス）/ Password（アプリパスワード）/ 送信元（同じ Gmail アドレス） |

> 全員が Google アカウントでログインするなら、③は後回しでも構いません（ただし招待メールの送信には③が必要です）。

## ④ GitHub（本番用の main と合言葉）

https://github.com/Beekon963/nicolyCRM を開いて操作します。

1. **本番用の `main` を作る**
   - ファイル一覧の上にあるブランチ名のボタン（`claude/nicoly-crm-requirements-2zdjuu`）→ **View all branches** → **New branch**
   - Name: `main`、Source: `claude/nicoly-crm-requirements-2zdjuu` → **Create new branch**
2. **`main` を既定にする**: **Settings → General → Default branch** の ⇄ ボタン → `main` → **Update**（確認が出たら了承）
   - これで、`main` に入ったものだけが本番に出ます。今後の変更はこちらで「プルリクエスト」を作るので、内容を確認して **Merge** してください
3. **合言葉（Secrets）を登録する**: **Settings → Secrets and variables → Actions → New repository secret** を4回

| Name | Secret |
|---|---|
| `SUPABASE_PROJECT_REF` | プロジェクトの英数字 |
| `SUPABASE_DB_PASSWORD` | データベースのパスワード |
| `SUPABASE_ACCESS_TOKEN` | アクセストークン（`sbp_` で始まる） |
| `SUPABASE_SECRET_KEY` | Secret key（`sb_secret_` で始まる） |

登録した値は、GitHub の画面でも見えなくなります。⑤・⑦ のボタンを押したときだけ使われます。

## ⑤ データベースを作る（GitHub のボタン）

1. リポジトリの **Actions** タブ → 左の一覧から **本番のデータベースを更新** → 右の **Run workflow**
   - Use workflow from: `main`
   - 何をするか: **確認だけ（反映しない）**
   - **Run workflow** を押す
2. 1〜2分で緑のチェック（✓）が付きます。開くと「反映される変更の一覧」に `20261006000001_base.sql` などが並んでいます（この時点では本番は変わっていません）
3. もう一度 **Run workflow** → 何をするか: **本番に反映する** → **Run workflow**。緑のチェックが付けば完了です

- 赤い ✕ が付いたときは、開いてエラーの文を確認してください（Secrets の入れ忘れ・打ち間違いが多いです）。分からなければ画面の写真を送ってください
- 今後、機能の追加でデータベースが変わるときは、こちらからお知らせします。同じ手順（確認だけ → 本番に反映する）で反映してください
- ダミーデータは入りません

## ⑥ Vercel（Pro）

④の 2（`main` を既定にする）を先に済ませてください。Vercel は既定のブランチを本番として公開します。

1. https://vercel.com/ で **Pro** プランのチームを使う（月 $20。商用利用は Pro が必要）
2. **Add New… → Project → Import Git Repository** で `Beekon963/nicolyCRM` を選ぶ
   - Project Name: `nicoly-crm`（URL が `https://nicoly-crm.vercel.app` になります）
3. **Environment Variables** に次を入れる

| 名前 | 値 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL（`https://（プロジェクトの英数字）.supabase.co`） |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key |
| `SUPABASE_SECRET_KEY` | Secret key |

4. **Deploy**。関数のリージョンはリポジトリの `vercel.json` で東京（`hnd1`）に固定済みです
   - 公開後の URL が `https://nicoly-crm.vercel.app` でなかった場合は、① の 4 の URL をその URL に書き換えてください
   - 独自ドメインを使う場合だけ、`NEXT_PUBLIC_SITE_URL` に `https://（独自ドメイン）` を入れて再デプロイしてください

## ⑦ 最初のオーナーを登録する（GitHub のボタン）

1. **Actions** タブ → **オーナーを登録** → **Run workflow**
   - Use workflow from: `main`
   - メールアドレス: ログインに使うアドレス（Google でログインするなら、その Google アカウントのアドレス）
   - 名前: `森部 太陽`
   - **Run workflow** を押す
2. 緑のチェックが付けば完了です（同じメールアドレスで何度実行しても大丈夫です）

## ⑧ ログインして名簿を取り込む

1. `https://nicoly-crm.vercel.app` を開き、「Google でログイン」（または「ログイン用のリンクを受け取る」）でログインする
2. 名簿を取り込む: [manual_admin.md](manual_admin.md) の「7. データ取り込み」を参照
3. 管理者の招待は「設定 → ユーザー」から行えます（③ が必要です）

---

## 付録A: パソコンのコマンドで ⑤・⑦ を行う場合

Node.js 22.18 以上と、このリポジトリのコピーが必要です。

```bash
git clone https://github.com/Beekon963/nicolyCRM.git
cd nicolyCRM
npm install
npx supabase login
npx supabase link --project-ref （プロジェクトの英数字）
npx supabase db push
```

オーナーの登録:

```bash
cat > .env.production.local <<'ENV'
NEXT_PUBLIC_SUPABASE_URL=https://（プロジェクトの英数字）.supabase.co
SUPABASE_SECRET_KEY=（Secret key）
ENV
node --env-file=.env.production.local scripts/create-owner.mts （メールアドレス） "森部 太陽"
```

## 付録B: 開発用の Supabase プロジェクト（任意）

普段の開発はこちらの環境で行うため、必須ではありません。ダミーデータで試す場所がほしい場合だけ作ります。

1. 本番とは**別の組織**（プラン **Free**）に、`nicoly-crm-dev` を Tokyo で作る（Pro の組織に作ると料金が追加でかかるため）
2. ① の 3〜5 と同じ設定をする。ただし URL は `http://localhost:3000` と `http://localhost:3000/auth/callback`
3. 付録A と同じ手順でつなぎ、ダミーデータを入れる場合は `npm run db:seed:generate && npx supabase db reset --linked`（**本番では絶対に実行しないでください。データが消えます**）

## 付録C: 開発用パソコンでの起動

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
| Supabase（開発用。作る場合） | Free | 0円 |
| メール送信（Resend / Gmail） | 無料枠 | 0円 |
| GitHub（ボタンの実行） | 無料枠 | 0円 |
| 合計 | | 約 $45（7,000円前後） |
