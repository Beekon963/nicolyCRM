-- =============================================================================
-- Phase 18: 管理用スプレッドシートを自動で読む（シートが正、CRM が追いかける）
--
-- - 10分ごとの自動実行（/api/cron/sheet-sync。秘密キー）が、今月・来月のタブを読んで
--   現場・必要人数・確定した予定・稼働可能日・単価を入れる（取り込みと同じ計算）
-- - シートから入れたものは台帳（sheet_sync_items）に残し、シートから消えたら CRM からも外す
--   （今日より前の分・報告や実績のある分は残す）
-- - 名簿にない人・ない会場・合わない名前は作らず、記録（sheet_syncs.report）に出して
--   画面で対応づける（sheet_name_aliases。次からは自動）
-- 設定は settings の 'sheet_sync'（{ enabled, spreadsheet_id, role_id }。金額なし）。
-- =============================================================================

-- 同期の記録（いつ・成功したか・何件・合わない名前）。書くのはサーバー（秘密キー）だけ
create table public.sheet_syncs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  ok boolean not null,
  message text not null default '',
  source text not null check (source in ('cron', 'button')),
  report jsonb not null default '{}'::jsonb
);
create index sheet_syncs_ran_at_idx on public.sheet_syncs (ran_at desc);

alter table public.sheet_syncs enable row level security;
create policy sheet_syncs_select on public.sheet_syncs
  for select to authenticated using (public.is_member());

-- シートから入れたものの台帳（月・種類・鍵）。シートから消えたものを見つけるために使う
create table public.sheet_sync_items (
  id bigint generated always as identity primary key,
  month date not null check (month = date_trunc('month', month)::date),
  kind text not null check (kind in ('event', 'assignment', 'availability')),
  -- event: 現場の id / assignment: アサインの id / availability: null（鍵 = スタッフ|日付）
  ref_id uuid,
  key text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (month, kind, key)
);

alter table public.sheet_sync_items enable row level security;
create policy sheet_sync_items_select on public.sheet_sync_items
  for select to authenticated using (public.is_member());

-- 名前の対応づけ（シートの書き方 → CRM の取引先・会場・スタッフ。place = 下の段にだけある場所 → その現場の取引先）
-- target_id が null = 取り込まない
create table public.sheet_name_aliases (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('client', 'venue', 'staff', 'place')),
  sheet_name text not null check (length(trim(sheet_name)) > 0),
  target_id uuid,
  created_by uuid references public.app_users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (kind, sheet_name)
);

alter table public.sheet_name_aliases enable row level security;
create policy sheet_name_aliases_select on public.sheet_name_aliases
  for select to authenticated using (public.is_member());
create policy sheet_name_aliases_write on public.sheet_name_aliases
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
