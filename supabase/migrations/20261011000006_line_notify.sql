-- =============================================================================
-- Phase 5: LINE 公式アカウントからの自動のお知らせ
--
-- - スタッフ・オーナー・管理者が、自分の LINE と CRM をつなぐ（マイページ / CRM の画面でコードを出し、
--   LINE 公式アカウントに送る。公式アカウントの受け口（webhook）が秘密キーでコードを確かめて line_user_id を入れる）
-- - お知らせ: スタッフ本人に確定のお知らせ・前日のお知らせ、社内（オーナー・管理者）に確定・新しい現場
-- - 送るものは line_outbox に入れ、サーバーが1分ごとに LINE に送る（入れてから1分たったものだけ。
--   「元に戻す」で取り消したものは送らない）。送った記録として残す（中身の文はここに持たない）
-- - 月の稼働表の取り込みでは送らない（画面の操作のときだけ入れる）
-- 金額は扱わない。
-- =============================================================================

alter table public.app_users add column line_user_id text;
create unique index app_users_line_user_id_key on public.app_users (line_user_id) where line_user_id is not null;
create unique index staff_line_user_id_key on public.staff (line_user_id) where line_user_id is not null;

-- つなぐためのコード（30分だけ有効。1回使ったら使えない）
create table public.line_link_codes (
  code text primary key check (code ~ '^[A-Z0-9]{8}$'),
  staff_id uuid references public.staff (id),
  app_user_id uuid references public.app_users (id),
  expires_at timestamptz not null default now() + interval '30 minutes',
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check ((staff_id is null) <> (app_user_id is null))
);

alter table public.line_link_codes enable row level security;
-- 自分（オーナー・管理者）のコードだけ読める。作る・使うのは関数だけ
create policy "line_link_codes: 自分の分は読める" on public.line_link_codes
  for select to authenticated using (app_user_id = (select auth.uid()));

-- 送るお知らせ（送った記録）
create table public.line_outbox (
  id uuid primary key default gen_random_uuid(),
  -- confirm: スタッフに確定のお知らせ / reminder: スタッフに前日のお知らせ
  -- admin_confirm: 社内に「確定しました」 / admin_events: 社内に「新しい現場」
  kind text not null check (kind in ('confirm', 'reminder', 'admin_confirm', 'admin_events')),
  -- 「元に戻す」でアサインが消えたら、送る前のお知らせも消える
  assignment_id uuid references public.assignments (id) on delete cascade,
  event_ids uuid[] not null default '{}',
  -- 操作した人（その人には社内向けのお知らせを送らない）
  actor_user_id uuid references public.app_users (id),
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  note text not null default '',
  attempts integer not null default 0,
  -- LINE に同じものを二重に送らないための鍵
  retry_key uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  check ((kind in ('confirm', 'reminder', 'admin_confirm')) = (assignment_id is not null))
);

create index line_outbox_pending_idx on public.line_outbox (created_at) where status = 'pending';
-- 前日のお知らせは1人1回
create unique index line_outbox_reminder_once on public.line_outbox (assignment_id) where kind = 'reminder';

alter table public.line_outbox enable row level security;
-- メンバーは送った記録を見られる。入れる・直すのはサーバー（秘密キー）だけ
create policy "line_outbox: メンバーは読める" on public.line_outbox
  for select to authenticated using ((select public.is_member()));

-- 設定（オーナーが画面でオンにする。初めはすべてオフ）
insert into public.settings (key, value)
values ('line', '{"staffConfirm": false, "reminder": false, "reminderHour": 18, "adminNotify": false}')
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- つなぐ: コードを作る
-- -----------------------------------------------------------------------------

create or replace function public.line_new_code()
returns text
language sql
volatile
set search_path = ''
as $$
  -- 紛らわしい文字（0/O・1/I）を除いた8文字
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 32), 1), '')
    from (select extensions.gen_random_bytes(8) as b) r, generate_series(0, 7) as i
$$;

-- スタッフ: マイページからつなぐ（本人の状態と、新しいコード）
create or replace function public.mypage_line_link(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ms record;
  c text;
begin
  select * into ms from public.mypage_staff(p_token);
  if ms.error is not null then return jsonb_build_object('error', ms.error); end if;
  delete from public.line_link_codes where staff_id = (ms.staff).id and used_at is null;
  c := public.line_new_code();
  insert into public.line_link_codes (code, staff_id) values (c, (ms.staff).id);
  return jsonb_build_object('linked', (ms.staff).line_user_id is not null, 'code', c);
end;
$$;

-- スタッフ: つながっているか
create or replace function public.mypage_line_status(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ms record;
begin
  select * into ms from public.mypage_staff(p_token);
  if ms.error is not null then return jsonb_build_object('error', ms.error); end if;
  return jsonb_build_object('linked', (ms.staff).line_user_id is not null);
end;
$$;

-- スタッフ: つなぐのをやめる
create or replace function public.mypage_line_unlink(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ms record;
begin
  select * into ms from public.mypage_staff(p_token);
  if ms.error is not null then return jsonb_build_object('error', ms.error); end if;
  update public.staff set line_user_id = null where id = (ms.staff).id;
  return jsonb_build_object('ok', true);
end;
$$;

-- オーナー・管理者: 自分の LINE をつなぐコード
create or replace function public.line_link_code_for_me()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c text;
begin
  if not public.is_member() then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from public.line_link_codes where app_user_id = auth.uid() and used_at is null;
  c := public.line_new_code();
  insert into public.line_link_codes (code, app_user_id) values (c, auth.uid());
  return c;
end;
$$;

-- オーナー・管理者: 自分の LINE をつなぐのをやめる
create or replace function public.line_unlink_me()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_member() then raise exception 'not allowed' using errcode = '42501'; end if;
  update public.app_users set line_user_id = null where id = auth.uid();
end;
$$;

-- LINE の受け口（秘密キー）: コードを確かめて LINE の利用者 ID を入れる。同じ LINE はほかの人から外す
create or replace function public.line_link_consume(p_code text, p_line_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lc public.line_link_codes;
  who text;
begin
  if p_line_user_id is null or p_line_user_id !~ '^U[0-9a-f]{32}$' then return jsonb_build_object('error', 'invalid'); end if;
  if not public.rate_limit_hit('line:link', 120) then return jsonb_build_object('error', 'rate_limited'); end if;
  select * into lc from public.line_link_codes
   where code = upper(p_code) and used_at is null and expires_at > now()
   for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  update public.line_link_codes set used_at = now() where code = lc.code;
  update public.staff set line_user_id = null where line_user_id = p_line_user_id;
  update public.app_users set line_user_id = null where line_user_id = p_line_user_id;
  if lc.staff_id is not null then
    update public.staff set line_user_id = p_line_user_id where id = lc.staff_id returning name into who;
    return jsonb_build_object('ok', true, 'kind', 'staff', 'name', who);
  end if;
  update public.app_users set line_user_id = p_line_user_id where id = lc.app_user_id returning name into who;
  return jsonb_build_object('ok', true, 'kind', 'user', 'name', who);
end;
$$;

-- LINE の受け口（秘密キー）: ブロックされたら外す
create or replace function public.line_unlink_user(p_line_user_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.staff set line_user_id = null where line_user_id = p_line_user_id;
  update public.app_users set line_user_id = null where line_user_id = p_line_user_id;
$$;

revoke execute on function public.line_new_code() from public, anon, authenticated;
revoke execute on function public.line_link_consume(text, text) from public, anon, authenticated;
revoke execute on function public.line_unlink_user(text) from public, anon, authenticated;
grant execute on function public.line_link_consume(text, text) to service_role;
grant execute on function public.line_unlink_user(text) to service_role;
grant execute on function public.mypage_line_link(text) to anon, authenticated;
grant execute on function public.mypage_line_status(text) to anon, authenticated;
grant execute on function public.mypage_line_unlink(text) to anon, authenticated;
grant execute on function public.line_link_code_for_me() to authenticated;
grant execute on function public.line_unlink_me() to authenticated;

-- 前日のお知らせを入れる（サーバーの定期実行から。同じ人には1回だけ）
create or replace function public.line_enqueue_reminders(p_date date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  insert into public.line_outbox (kind, assignment_id)
  select 'reminder', a.id
    from public.assignments a
    join public.events e on e.id = a.event_id
   where e.date = p_date and e.cancelled_at is null and a.status = 'confirmed' and a.reminder_sent_at is null
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.line_enqueue_reminders(date) from public, anon, authenticated;
grant execute on function public.line_enqueue_reminders(date) to service_role;
