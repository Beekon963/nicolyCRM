-- Phase 22: 稼働表を見やすく作り直す（日・週・月）
-- 稼働表のチップに出す短い名前 = 「扱うキャリア（取引先）」＋「場所の短い名前（会場）」。
-- どちらも金額ではないので、オーナー・管理者が読める（見るだけリンクの board_json には足さない。見るだけリンクは今のまま）。

alter table public.companies
  add column if not exists carrier text not null default ''
    check (carrier in ('', 'docomo', 'au', 'softbank', 'rakuten', 'other'));  -- 扱うキャリア（取引先のとき。空 = 未設定）

alter table public.venues
  add column if not exists short_name text not null default ''
    check (length(short_name) <= 20);  -- 稼働表のチップに出す場所の短い名前（例: 村山）。空なら会場名の先頭を使う
