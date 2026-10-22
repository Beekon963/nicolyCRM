-- =============================================================================
-- Phase 18: LINE から転送された文の受信箱
--
-- オーナー・管理者が、LINE に来た文（報告・返事・依頼・案件詳細）を公式アカウントに「転送」すると、
-- 受け口（webhook。秘密キー）がそのまま文をここに入れる。登録は画面の「LINE から入れる」で
-- 読み取って確かめてから（AI や受け口が直接登録することはない）。
-- 受けるのは、自分の LINE を CRM とつないだオーナー・管理者からの文だけ。金額は扱わない。
-- =============================================================================

create table public.line_inbox (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references public.app_users (id),
  text text not null check (length(text) between 1 and 10000),
  created_at timestamptz not null default now(),
  -- 画面で読み取って済みにした時刻（null = まだ）
  done_at timestamptz
);
create index line_inbox_open_idx on public.line_inbox (created_at desc) where done_at is null;

alter table public.line_inbox enable row level security;
-- メンバーは読める。済みにするのもメンバー。入れるのは受け口（秘密キー）だけ
create policy line_inbox_select on public.line_inbox
  for select to authenticated using (public.is_member());
create policy line_inbox_update on public.line_inbox
  for update to authenticated using (public.is_member()) with check (public.is_member());
