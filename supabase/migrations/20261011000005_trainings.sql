-- =============================================================================
-- Phase 4-3: オンライン研修の日程調整（TimeRex のような予約）
--
-- - オーナー・管理者が研修の枠（日時・定員・オンラインの URL）を作る
-- - 予約用リンク（推測できない長い鍵の URL。見るだけリンクと同じ share_links に kind = 'training'）を LINE で送る
-- - 受ける人はログインなしで空いている枠を選んで予約・自分でキャンセルできる
--   （予約ごとに長いランダムな「控えの鍵」を返し、その URL で見直し・キャンセルする。
--     控えは予約用リンクを止めた・作り直したあとも見られる＝参加の URL を見失わない）
-- - ログインしていない人が使える関数は training_public_* だけ。ほかの人の名前・連絡先は返さない。回数制限あり
-- 金額は扱わない。
-- =============================================================================

alter table public.share_links drop constraint share_links_kind_check;
alter table public.share_links add constraint share_links_kind_check check (kind in ('board', 'training'));

create table public.training_slots (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'オンライン研修' check (length(btrim(title)) > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null default 1 check (capacity between 1 and 100),
  -- オンラインの研修に入る URL（予約した人に出す。http(s) だけ）
  meeting_url text not null default '' check (meeting_url = '' or meeting_url ~ '^https?://[^\s]+$'),
  note text not null default '',
  is_active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index training_slots_starts_idx on public.training_slots (starts_at);

create table public.training_bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.training_slots (id),
  name text not null check (length(btrim(name)) > 0),
  contact text not null default '',
  memo text not null default '',
  source text not null default 'link' check (source in ('link', 'admin')),
  -- 予約した人が見直し・キャンセルするための鍵（予約のときに1回だけ返す）
  cancel_token text not null unique default public.new_mypage_token() check (length(cancel_token) >= 40),
  -- Google カレンダーに入れた予定（連携しているとき）
  calendar_event_id text,
  cancelled_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index training_bookings_slot_idx on public.training_bookings (slot_id) where cancelled_at is null;

alter table public.training_slots enable row level security;
alter table public.training_bookings enable row level security;

-- メンバー（オーナー・管理者）は読み書きできる。消さずに止める・取り消す
create policy "training_slots: メンバーは読める" on public.training_slots for select to authenticated using ((select public.is_member()));
create policy "training_slots: メンバーが作る" on public.training_slots for insert to authenticated with check ((select public.is_member()));
create policy "training_slots: メンバーが直す" on public.training_slots for update to authenticated using ((select public.is_member())) with check ((select public.is_member()));
create policy "training_bookings: メンバーは読める" on public.training_bookings for select to authenticated using ((select public.is_member()));
create policy "training_bookings: メンバーが入れる" on public.training_bookings for insert to authenticated with check ((select public.is_member()));
create policy "training_bookings: メンバーが直す" on public.training_bookings for update to authenticated using ((select public.is_member())) with check ((select public.is_member()));

-- 予約用リンクの鍵を確かめる（回数制限つき）。正しければ null、だめならエラーの種類
create or replace function public.training_link_error(p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token is null or length(p_token) < 40
     or not exists (select 1 from public.share_links where kind = 'training' and token = p_token and is_active) then
    perform public.rate_limit_hit('training:invalid', 300);
    return 'invalid_token';
  end if;
  if not public.rate_limit_hit('training:link', 300) then
    return 'rate_limited';
  end if;
  return null;
end;
$$;

-- 予約できる枠（今から1時間後〜60日先。満席も「満席」と出すために返す。予約した人の名前は返さない）
create or replace function public.training_public_slots(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  err text := public.training_link_error(p_token);
begin
  if err is not null then return jsonb_build_object('error', err); end if;
  return jsonb_build_object('slots', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'title', s.title, 'starts_at', s.starts_at, 'ends_at', s.ends_at, 'note', s.note,
      'left', greatest(s.capacity - (select count(*) from public.training_bookings b where b.slot_id = s.id and b.cancelled_at is null), 0)
    ) order by s.starts_at)
    from public.training_slots s
    where s.is_active and s.starts_at > now() + interval '1 hour' and s.starts_at < now() + interval '60 days'
  ), '[]'::jsonb));
end;
$$;

-- 予約する。定員を超えないよう枠に鍵をかけて数える
create or replace function public.training_public_book(p_token text, p_slot_id uuid, p_name text, p_contact text, p_memo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  err text := public.training_link_error(p_token);
  s public.training_slots;
  b public.training_bookings;
  taken integer;
begin
  if err is not null then return jsonb_build_object('error', err); end if;
  if coalesce(btrim(p_name), '') = '' or length(p_name) > 50 or length(coalesce(p_contact, '')) > 100 or length(coalesce(p_memo, '')) > 500 then
    return jsonb_build_object('error', 'invalid_input');
  end if;
  select * into s from public.training_slots where id = p_slot_id for update;
  if not found or not s.is_active or s.starts_at <= now() + interval '1 hour' then
    return jsonb_build_object('error', 'closed');
  end if;
  select count(*) into taken from public.training_bookings where slot_id = s.id and cancelled_at is null;
  if taken >= s.capacity then return jsonb_build_object('error', 'full'); end if;
  insert into public.training_bookings (slot_id, name, contact, memo, source, created_by)
  values (s.id, btrim(p_name), btrim(coalesce(p_contact, '')), btrim(coalesce(p_memo, '')), 'link', null)
  returning * into b;
  return jsonb_build_object('ok', true, 'booking_id', b.id, 'cancel_token', b.cancel_token);
end;
$$;

-- 予約の控えの鍵を確かめる（回数制限つき）。予約用リンクを止めた・作り直したあとも、控えは見られる
create or replace function public.training_booking_by_key(p_cancel_token text, out booking_id uuid, out error text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_cancel_token is not null and length(p_cancel_token) >= 40 then
    select b.id into booking_id from public.training_bookings b where b.cancel_token = p_cancel_token;
  end if;
  if booking_id is null then
    perform public.rate_limit_hit('training:invalid', 300);
    error := 'not_found';
    return;
  end if;
  if not public.rate_limit_hit('training:b:' || booking_id::text, 60) then
    booking_id := null;
    error := 'rate_limited';
  end if;
end;
$$;

-- 予約した人が見直す（控えの鍵で本人の予約だけ。オンラインの URL はここで返す）
create or replace function public.training_public_booking(p_cancel_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k record;
  r record;
begin
  select * into k from public.training_booking_by_key(p_cancel_token);
  if k.error is not null then return jsonb_build_object('error', k.error); end if;
  select b.id, b.name, b.cancelled_at, s.title, s.starts_at, s.ends_at, s.meeting_url, s.note
    into r
    from public.training_bookings b join public.training_slots s on s.id = b.slot_id
   where b.id = k.booking_id;
  return jsonb_build_object(
    'id', r.id, 'name', r.name, 'title', r.title, 'starts_at', r.starts_at, 'ends_at', r.ends_at,
    'meeting_url', r.meeting_url, 'note', r.note, 'cancelled', r.cancelled_at is not null,
    'can_cancel', r.cancelled_at is null and r.starts_at > now()
  );
end;
$$;

-- 予約した人がキャンセルする（始まる前まで）
create or replace function public.training_public_cancel(p_cancel_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k record;
  bid uuid;
begin
  select * into k from public.training_booking_by_key(p_cancel_token);
  if k.error is not null then return jsonb_build_object('error', k.error); end if;
  update public.training_bookings b set cancelled_at = now()
    from public.training_slots s
   where s.id = b.slot_id and b.id = k.booking_id and b.cancelled_at is null and s.starts_at > now()
  returning b.id into bid;
  if bid is null then return jsonb_build_object('error', 'cannot_cancel'); end if;
  return jsonb_build_object('ok', true, 'booking_id', bid);
end;
$$;

revoke execute on function public.training_link_error(text) from public, anon, authenticated;
revoke execute on function public.training_booking_by_key(text) from public, anon, authenticated;
grant execute on function public.training_public_slots(text) to anon, authenticated;
grant execute on function public.training_public_book(text, uuid, text, text, text) to anon, authenticated;
grant execute on function public.training_public_booking(text) to anon, authenticated;
grant execute on function public.training_public_cancel(text) to anon, authenticated;
