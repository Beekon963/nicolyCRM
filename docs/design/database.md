# DB スキーマ設計（Phase 0 案）

要件 §8 のデータモデル案を精査し、Phase 0 の回答（[../phase0-questions.md](../phase0-questions.md)）を反映したもの。**承認後、Phase 1 の最初にマイグレーションとして作成する。**
`★` はオーナーのみ読み書きできるテーブル（管理者からは RLS で読めない）。権限の詳細は [security.md](security.md)。

## 1. 設計の方針（かんたんに）

| 方針 | 内容 |
|---|---|
| お金は別テーブル | 単価・日当・支払額・口座などは ★ テーブルにだけ置く。管理者が読めるテーブルに金額の列は1つも置かない（交通費・経費の申請額だけは例外。要件 §3 で管理者に見せる） |
| 消さない | 基本は「無効化」「アーカイブ」。マスタ（役割・獲得項目など）は無効化で、過去データを壊さない |
| 日付は日本時間 | 開催日などは `date`（日本時間の暦日）、時刻は `time`、記録日時は `timestamptz` |
| 状態は計算で出す | 現場の「人員確定」「実施済」「実績確定」「締め済」は、保存せずに必要人数・日付・実績・締めの状態から毎回計算する（自動切替の取りこぼしがない）。保存するのは「中止」だけ |
| 履歴を残す | 金額・実績・アサインの状態・営業ステータスの変更は、トリガーで `audit_logs` に自動記録 |
| 締めたら固定 | 締めた月の実績・単価・経費・調整額は、DB のトリガーで変更を拒否する（オーナーがロック解除した場合だけ変更可） |

## 2. ER 図

見やすさのため4つに分けている（同じ名前のテーブルは同じもの）。

### 2-1. 現場・アサイン・実績

```mermaid
erDiagram
  companies ||--o{ events : "取引先として発注"
  venues ||--o{ events : "会場"
  event_groups ||--o{ events : "一括作成のまとまり"
  events ||--o{ event_requirements : "役割別の必要人数"
  roles ||--o{ event_requirements : ""
  events ||--o{ assignments : "アサイン"
  staff ||--o{ assignments : ""
  roles ||--o{ assignments : "担当する役割"
  assignments ||--o| reports : "実績報告"
  assignments ||--o{ report_items : "獲得件数"
  items ||--o{ report_items : "獲得項目"
  assignments ||--o{ expenses : "交通費・経費"
  companies ||--o{ company_items : "この取引先で使う獲得項目"
  items ||--o{ company_items : ""

  events {
    uuid id PK
    uuid client_id FK "取引先"
    uuid venue_id FK "会場"
    date date "開催日"
    time start_time "開始"
    time end_time "終了"
    time meeting_time "集合時刻"
    text meeting_place "集合場所"
    text belongings "服装・持ち物"
    text notes "注意事項"
    uuid group_id FK "グループ"
    timestamptz cancelled_at "中止"
  }
  event_requirements {
    uuid event_id PK
    uuid role_id PK
    int required_count "必要人数"
  }
  assignments {
    uuid id PK
    uuid event_id FK
    uuid staff_id FK
    uuid role_id FK
    enum status "打診中/確定/補欠/辞退/キャンセル/当日不稼働"
    timestamptz offered_at "打診日時"
    timestamptz responded_at "回答日時"
    timestamptz confirm_notice_sent_at "確定連絡を送った"
    timestamptz reminder_sent_at "前日リマインドを送った"
    text cancel_reason "キャンセル理由"
  }
  reports {
    uuid assignment_id PK
    text comment "一言コメント"
    timestamptz submitted_at "送信日時"
    enum source "本人/管理者"
    timestamptz confirmed_at "管理者が確定した日時"
    uuid confirmed_by FK
  }
  report_items {
    uuid assignment_id PK
    uuid item_id PK
    int reported_count "速報件数"
    int confirmed_count "確定件数"
    enum diff_reason "キャンセル/否認/入力ミス/その他"
    text diff_note
  }
  company_items {
    uuid company_id PK
    uuid item_id PK
  }
  expenses {
    uuid id PK
    uuid assignment_id FK
    uuid staff_id FK
    enum kind "交通費/その他"
    int amount "申請額（円）"
    text memo "区間メモなど"
    enum status "申請/承認/却下"
    uuid reviewed_by FK
  }
```

### 2-2. スタッフ・会場・マスタ

```mermaid
erDiagram
  ranks ||--o{ staff : "ランク"
  staff ||--o{ staff_roles : ""
  roles ||--o{ staff_roles : "できる役割（複数）"
  staff ||--o{ staff_areas : ""
  areas ||--o{ staff_areas : "対応エリア（複数）"
  staff ||--o| staff_private : "★お金・個人情報"
  staff ||--o{ staff_ng : "NG"
  venues ||--o{ staff_ng : "会場NG"
  companies ||--o{ staff_ng : "取引先NG"
  staff ||--o{ staff_notes : "稼働履歴メモ"
  staff ||--o{ availability : "稼働可能日"
  staff ||--o{ availability_submissions : "月ごとの提出"
  areas ||--o{ venues : "エリア"

  staff {
    uuid id PK
    text name "氏名"
    text kana "かな"
    text phone "電話"
    text line_name "LINE表示名"
    text nearest_station "最寄り駅"
    uuid rank_id FK
    enum status "稼働中/休止/終了"
    text memo
    text mypage_token "マイページURLの鍵"
    timestamptz token_rotated_at "再発行日時"
    text line_user_id "将来のLINE連携用（空）"
  }
  staff_private {
    uuid staff_id PK
    int base_daily_rate "基本日当"
    enum withholding_method "なし/報酬・料金/外交員報酬"
    text invoice_number "T+13桁"
    date contract_date "契約締結日"
    text contract_file_path "契約書PDF"
    text bank_name "銀行"
    text bank_branch "支店"
    enum account_type "普通/当座"
    text account_number "口座番号"
    text account_holder_kana "名義カナ"
  }
  staff_ng {
    uuid id PK
    uuid staff_id FK
    uuid venue_id FK "会場NG（どちらか一方）"
    uuid company_id FK "取引先NG（どちらか一方）"
    text reason
  }
  staff_notes {
    uuid id PK
    uuid staff_id FK
    date date
    enum kind "直前キャンセル/遅延/トラブル/良かった点/その他"
    text memo
    bool is_auto "自動記録"
    uuid assignment_id FK "元になったアサイン"
  }
  availability {
    uuid staff_id PK
    date date PK
    enum status "○/△/×（未入力は行なし）"
    enum source "本人/管理者"
  }
  availability_submissions {
    uuid staff_id PK
    date month PK "対象月（1日）"
    text memo "メモ欄"
    timestamptz submitted_at "提出日時"
    enum source "本人/管理者"
  }
  venues {
    uuid id PK
    text name
    text address
    text nearest_station
    text prefecture
    uuid area_id FK
    text access_notes "入館方法"
    text green_room "控室"
    text parking "駐車場"
    text memo
  }
```

マスタ（`roles` 役割 / `items` 獲得項目 / `ranks` ランク / `areas` エリア）はすべて `id, name, sort_order, is_active`（ランクは定義メモ `description` も）。

| マスタ | 初期値（Phase 0 で決定。設定画面で追加・名前変更・並び替え・無効化できる） |
|---|---|
| 役割 | クローザー / キャッチャー / ディレクター |
| 獲得項目 | 新規 / MNP / 機種変更 / ドコモ光 / home 5G / dカード・でんき等の付帯 |
| ランク | SS / S / A＋ / A / B / C / D / E（上ほど高い。候補一覧の並び順にも使う） |
| エリア | 空（取り込み・登録時に作る） |

獲得項目は取引先ごとに使うものを選べる（`company_items`）。選んでいない取引先の現場では、有効な項目をすべて出す。

### 2-3. 営業（取引先・協力会社）

```mermaid
erDiagram
  app_users ||--o{ companies : "担当者"
  companies ||--o{ contacts : "先方の担当者"
  companies ||--o{ activities : "活動履歴"
  contacts ||--o{ activities : ""
  app_users ||--o{ activities : "記録者"
  companies ||--o{ company_links : "関連資料のリンク"

  companies {
    uuid id PK
    enum kind "取引先/協力会社"
    text name
    text kana
    text name_key "重複判定用（株式会社などを除いた名前）"
    text phone
    text address
    text website
    enum status "未接触/接触済み/商談設定/商談済み/取引中/見送り・休眠"
    enum priority "高/中/低"
    uuid owner_user_id FK "担当"
    date next_action_date "次回アクション日"
    text next_action "次にやること"
    text memo
  }
  contacts {
    uuid id PK
    uuid company_id FK
    text name
    text title "役職"
    text phone
    text email
    text line
    text memo
  }
  activities {
    uuid id PK
    uuid company_id FK
    uuid contact_id FK
    uuid user_id FK "記録者"
    enum kind "架電/LINE/メール/訪問/商談/その他"
    enum result "つながった/不在/折り返し待ち/資料送付/アポ獲得/見送り"
    text memo
    timestamptz occurred_at
    date next_action_date "このとき設定した次回アクション日"
  }
```

### 2-4. お金（★ すべてオーナーのみ）

```mermaid
erDiagram
  companies ||--o| company_billing : "★請求設定"
  companies ||--o{ client_rates : "★標準単価"
  venues ||--o{ client_rates : "★取引先×会場の標準"
  ranks ||--o| rank_rates : "★ランクごとの基準日当"
  events ||--o{ event_rates : "★現場ごとの上書き"
  items ||--o| incentive_rates : "★インセンティブ標準単価"
  events ||--o{ event_incentive_rates : "★現場ごとの上書き"
  assignments ||--o| assignment_private : "★日当の上書き"
  staff ||--o{ payment_adjustments : "★調整額"
  monthly_closings ||--o{ closing_logs : "★締め・ロック解除の履歴"
  staff ||--o{ payments : "★支払い（締め時のスナップショット）"
  companies ||--o{ invoices : "★請求（締め時のスナップショット）"

  company_billing {
    uuid company_id PK
    int closing_day "締め日（0=末日）"
    text invoice_note "請求書送付先メモ"
    bool bill_transport "交通費を請求に含める"
  }
  rank_rates {
    uuid rank_id PK
    int base_daily_rate "基準日当（登録・取り込み時の初期値）"
  }
  client_rates {
    uuid id PK
    uuid company_id FK
    uuid venue_id FK "空なら取引先全体の標準"
    enum kind "人日/現場固定/成果"
    uuid role_id FK "人日のとき"
    uuid item_id FK "成果のとき"
    int amount
  }
  event_rates {
    uuid id PK
    uuid event_id FK
    enum kind
    uuid role_id FK
    uuid item_id FK
    int amount
  }
  incentive_rates {
    uuid item_id PK
    int amount
  }
  event_incentive_rates {
    uuid event_id PK
    uuid item_id PK
    int amount
  }
  assignment_private {
    uuid assignment_id PK
    int daily_rate_override "日当の上書き"
  }
  payment_adjustments {
    uuid id PK
    uuid staff_id FK
    date month "対象月"
    int amount "＋/−"
    text reason "必須"
  }
  monthly_closings {
    date month PK
    enum status "締め済/ロック解除中"
    timestamptz closed_at
    uuid closed_by FK
  }
  closing_logs {
    uuid id PK
    date month FK
    enum action "締め/ロック解除/再締め"
    text reason
    uuid user_id FK
  }
  payments {
    uuid id PK
    uuid staff_id FK
    date month
    int daily_total "日当計"
    int incentive_total "インセンティブ計"
    int adjustment_total "調整計"
    int expense_total "交通費・経費計"
    int withholding_base "源泉対象額"
    int withholding_amount "源泉額"
    int net_amount "差引支払額"
    enum status "未確定/確定/支払済"
    date paid_on "支払日"
    jsonb detail "現場ごとの明細"
  }
  invoices {
    uuid id PK
    uuid company_id FK
    date month
    int subtotal "税抜"
    int tax "消費税"
    int total "税込"
    jsonb detail "現場ごとの明細"
  }
```

## 3. その他のテーブル

| テーブル | 主な項目 | 読める人 |
|---|---|---|
| `app_users` | id（auth.users）、氏名、メール、権限（owner / manager）、有効フラグ | オーナー・管理者（変更はオーナー） |
| `event_groups` | 名前、作成者 | オーナー・管理者 |
| `message_templates` | 種類（打診 / 確定連絡 / 前日リマインド / 提出依頼［全体］/ 提出リマインド［個別］/ 実績報告のお願い）、本文 | オーナー・管理者（変更はオーナー） |
| `settings` | キーと値。稼働可能日の締切日（20）、実績報告の期限（7日）、会社情報など **金額に関係しない設定** | オーナー・管理者（変更はオーナー） |
| ★`owner_settings` | キーと値。消費税の端数処理、源泉の計算方法（交通費を含めるか・税込/税抜）など | オーナーのみ |
| ★`monthly_targets` | 対象月、売上目標、粗利目標 | オーナーのみ |
| ★`audit_logs` | 対象テーブル、行ID、操作、変更前、変更後、変更した人（ユーザー or スタッフ）、日時 | オーナーのみ（※） |
| `rate_limits` | マイページのアクセス回数の記録 | 誰も直接読めない（DB 関数だけが使う） |

※ 実績の「誰が・いつ・何から何に」は、実績確認画面で管理者にも見せる必要がある（要件 §4.7）。金額を含まない実績の履歴だけを返す関数を用意する。

**ファイル**: 契約書 PDF は Supabase Storage の非公開バケット `contracts`（オーナーのみ）。

## 4. 計算で出すもの（ビュー・関数）

| 名前 | 内容 |
|---|---|
| `event_overview`（ビュー） | 現場ごとの必要人数・確定人数・欠員（役割別）・未回答の打診数・未報告数・表示用ステータス |
| `event_candidates(event_id)`（関数） | 候補一覧。稼働可能日・ダブルブッキング・NG・ランク・平均獲得件数（直近3か月、確定ベース）・エリア一致・注意事項の回数（直近6か月）と並び順 |
| `staff_item_stats`（ビュー） | スタッフ別の平均獲得件数（確定ベース） |
| `home_todo()`（関数） | ホームの「要対応」の件数と一覧 |
| お金の集計（Phase 3） | 計算式は `src/lib/money` に置き、DB からは材料（人数・件数・単価）だけを取り出す |

### 現場の表示用ステータス（保存しない）

上から順に判定する。

1. **中止** … `cancelled_at` がある
2. **締め済** … その月が締め済み
3. **実績確定** … 開催日を過ぎていて、稼働したアサイン全員の実績が確定済み
4. **実施済** … 開催日を過ぎている（日本時間）
5. **人員確定** … すべての役割で確定人数 ≥ 必要人数
6. **予定** … それ以外

## 5. 要件 §8 からの主な変更点（精査の結果）

| 変更 | 理由 |
|---|---|
| `users` → `app_users` | Supabase の認証用テーブル `auth.users` と名前が紛らわしいため |
| 役割・エリアを配列ではなく中間テーブル（`staff_roles`、`staff_areas`）に | マスタを無効化・名前変更しても整合性が保てる。絞り込みも速い |
| `availability_submissions` を追加 | 「提出済み / 未提出」を正しく判定するため（日ごとの入力だけでは「まだ途中」か「全部 × で提出」か区別できない）。月ごとのメモもここに置く |
| `reports` に確定者・確定日時を持たせる | 確定は「スタッフ1人×現場1つ」単位で行うため（要件 §4.7）。確定後は本人が修正できない判定にも使う |
| ★`company_billing` を追加 | 取引先の締め日・請求書送付先メモ・交通費を請求するかはオーナーのみ（要件 §4.8）。`companies` は管理者も読むので分ける |
| `settings` を `settings` と ★`owner_settings`、★`monthly_targets` に分ける | 月次目標（売上・粗利）や税の設定は金額情報のため |
| ★`closing_logs` を追加 | ロック解除の理由と履歴を残すため（要件 §4.9） |
| `payments`・`invoices` に `detail`（明細）を追加 | 締めたあとに単価を直しても、締め時点の明細でCSVを出せるように |
| 現場のステータスを保存しない | 自動切替（人員確定・実施済）を確実にするため。中止だけ保存 |
| `rate_limits` を追加 | マイページのレート制限用（要件 §4.5） |
| 「主な取引先」（会場）は保存しない | 過去の現場から自動で出す |
| ★`rank_rates` を追加 | Phase 0 決定2。ランクごとの基準日当（スタッフ登録・取り込み時の初期値） |
| `company_items` を追加 | Phase 0 決定3。取引先ごとに使う獲得項目 |
| `client_rates` に `venue_id` を追加 | Phase 0 決定4。取引先×会場ごとの標準単価。使う順は 現場の上書き（`event_rates`）→ 取引先×会場 → 取引先 |

## 6. 制約・ルール（DB で守るもの）

- 同じ現場に同じスタッフは1回だけ（`assignments` の `event_id + staff_id` は重複不可）。
- 「参加できる」の自動確定は DB 関数の中で行い、同時に押されても定員を超えて確定しない（行ロック）。
- 実績報告・修正は「稼働日〜7日後（設定値）」かつ「未確定」のときだけ受け付ける（DB 関数で判定）。
- 速報と確定件数が違うときは差分理由が必須（CHECK 制約）。
- 調整額の理由は必須。インボイス登録番号は `T` ＋13桁（CHECK 制約）。
- 締め済みの月の実績・単価・経費・調整額・日当上書きは変更不可（トリガー）。
- NG は会場か取引先のどちらか一方だけ（CHECK 制約）。
- 検索用に「かな（ひらがな→カタカナにそろえたもの）」「電話番号（数字だけ）」の列を自動生成する。
