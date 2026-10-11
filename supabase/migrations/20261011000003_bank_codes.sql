-- =============================================================================
-- Phase 3-5: 全銀フォーマットの振込データ用に、スタッフの口座へ銀行番号・支店番号を足す（オーナーだけのテーブル）
-- 振込元の口座・委託者コードは owner_settings（key = 'zengin'）に入れる。freee の書き出しの設定は key = 'freee_export'。
-- =============================================================================

alter table public.staff_private
  add column bank_code text check (bank_code is null or bank_code ~ '^[0-9]{4}$'),
  add column branch_code text check (branch_code is null or branch_code ~ '^[0-9]{3}$');

comment on column public.staff_private.bank_code is '銀行番号（4桁）';
comment on column public.staff_private.branch_code is '支店番号（3桁）';
