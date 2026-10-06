-- =============================================================================
-- 初期データ（本番にも入る）。Phase 0 の決定（docs/phase0-questions.md）に合わせる
-- 金額（ランクの基準日当・単価など）はここに入れない。オーナーが設定画面で入力する
-- =============================================================================

insert into public.roles (name, sort_order) values
  ('クローザー', 1),
  ('キャッチャー', 2),
  ('ディレクター', 3);

insert into public.items (name, sort_order) values
  ('新規', 1),
  ('MNP', 2),
  ('機種変更', 3),
  ('ドコモ光', 4),
  ('home 5G', 5),
  ('dカード・でんき等の付帯', 6);

insert into public.ranks (name, sort_order) values
  ('SS', 1),
  ('S', 2),
  ('A＋', 3),
  ('A', 4),
  ('B', 5),
  ('C', 6),
  ('D', 7),
  ('E', 8);

insert into public.settings (key, value) values
  -- 稼働可能日の提出締切（毎月この日までに翌月分）
  ('availability_deadline_day', '20'),
  -- 実績報告の期限（稼働日から何日後まで）
  ('report_window_days', '7'),
  -- 会社情報
  ('company_profile', '{"name": "NICOLY", "address": "", "phone": "", "email": ""}');

insert into public.owner_settings (key, value) values
  -- 消費税率（%）と端数処理（floor 切り捨て / round 四捨五入 / ceil 切り上げ）
  ('consumption_tax', '{"rate_percent": 10, "rounding": "floor"}'),
  -- 源泉徴収の対象額: 交通費を含めるか、税込で計算するか（要件 §13-7）
  ('withholding', '{"include_expenses": true, "tax_inclusive": true}');

insert into public.message_templates (kind, body) values
('offer', $t${名前}さん
お疲れさまです、NICOLYです！
下の現場に入れますか？

📅 {日付}({曜日}) {時間}
📍 {会場名}
👤 {役割}

マイページから「参加できる / できない」を押してください👇
{マイページURL}$t$),
('confirm', $t${名前}さん
{日付}({曜日}) {会場名} の稼働が確定しました！よろしくお願いします。

⏰ 集合 {集合時刻} {集合場所}
🕘 稼働 {時間}
📍 {住所}
🎒 服装・持ち物 {持ち物}

終わったらマイページから実績報告をお願いします。
{マイページURL}$t$),
('reminder', $t${名前}さん
明日 {日付}({曜日}) は {会場名} です。よろしくお願いします！

⏰ 集合 {集合時刻} {集合場所}
📍 {住所}
🎒 服装・持ち物 {持ち物}

予定はマイページでも確認できます。
{マイページURL}$t$),
('availability_request', $t$お疲れさまです、NICOLYです！
{対象月}の稼働可能日を、{締切日}までに各自のマイページから提出してください🙏
（マイページはいつものURLから開けます）$t$),
('availability_reminder', $t${名前}さん
{対象月}の稼働可能日がまだ出ていないようです。
{締切日}までにこちらから提出をお願いします！
{マイページURL}$t$),
('report_request', $t${名前}さん
{日付}({曜日}) {会場名} おつかれさまでした！
獲得件数・交通費の報告をマイページからお願いします。
{マイページURL}$t$);
