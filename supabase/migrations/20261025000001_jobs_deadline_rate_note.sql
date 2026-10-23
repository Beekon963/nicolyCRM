-- Phase 21-6: 書き方の違う案件の文を要素に分解して読む
-- 案件にエントリー期限（取引先に返事をする期限）を、案件の単価（オーナーだけ）に
-- 単価のまわりの文（「弱 30,000円 / 一律 24,000円」のような金額の行。金額が入るのでオーナーだけ）を足す。
-- event_group_private は Phase 21 で作った金額のテーブル（オーナーだけが読める。tests/db/money-tables.ts で確認）

alter table public.event_groups
  add column if not exists entry_deadline date;  -- エントリー期限（取引先に返事をする期限）

alter table public.event_group_private
  add column if not exists rate_note text not null default '';  -- 単価のまわりの文（オーナーだけ）
