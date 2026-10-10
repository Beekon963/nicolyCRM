-- =============================================================================
-- Phase 1.5: 稼働表の「見るだけリンク」
--
-- 現場リーダー・スタッフが、ログインなしで稼働表を見られるリンク（推測できない長い鍵の URL）。
-- - 見られるのは: 現場（取引先・会場・必要/確定人数・欠員）、確定した予定、稼働可能日、ランク・最寄り駅
-- - 金額・電話番号・マイページの鍵・打診中の情報は返さない
-- - 発行・再発行（古いリンクはすぐ使えなくなる）・停止はオーナーだけ。管理者はリンクを見てコピーできる
-- =============================================================================

create table public.share_links (
  kind text primary key check (kind in ('board')),
  token text not null unique default public.new_mypage_token() check (length(token) >= 40),
  is_active boolean not null default true,
  rotated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

alter table public.share_links enable row level security;

create policy share_links_select on public.share_links
  for select to authenticated using (public.is_member());
create policy share_links_insert on public.share_links
  for insert to authenticated with check (public.is_owner());
create policy share_links_update on public.share_links
  for update to authenticated using (public.is_owner()) with check (public.is_owner());

-- 見るだけリンクから稼働表を読む（anon が実行できる。鍵を確かめてから、金額のない情報だけ返す）
create or replace function public.share_board(p_token text, p_month date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m_start date := date_trunc('month', p_month)::date;
  m_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  cur date := date_trunc('month', public.jst_today())::date;
begin
  if p_token is null or length(p_token) < 40
     or not exists (select 1 from public.share_links where kind = 'board' and token = p_token and is_active) then
    -- 鍵の総当たり対策（全体で1分300回まで）
    perform public.rate_limit_hit('share:invalid', 300);
    return jsonb_build_object('error', 'invalid_token');
  end if;
  -- リンク全体で1分600回まで
  if not public.rate_limit_hit('share:board', 600) then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  -- 見られるのは先月〜3か月先
  if p_month is null or m_start < (cur - interval '1 month')::date or m_start > (cur + interval '3 month')::date then
    return jsonb_build_object('error', 'out_of_range');
  end if;

  return jsonb_build_object(
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'date', o.date,
        'client_id', o.client_id, 'client_name', c.name,
        'venue_id', o.venue_id, 'venue_name', v.name,
        'required_total', o.required_total, 'confirmed_total', o.confirmed_total, 'shortage_total', o.shortage_total,
        'cancelled', o.cancelled_at is not null
      ) order by o.date)
      from public.event_overview o
      join public.companies c on c.id = o.client_id
      join public.venues v on v.id = o.venue_id
      where o.date between m_start and m_end
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'event_id', a.event_id, 'staff_id', a.staff_id, 'role_id', a.role_id, 'status', a.status))
      from public.assignments a join public.events e on e.id = a.event_id
      where a.status = 'confirmed' and e.cancelled_at is null and e.date between m_start and m_end
    ), '[]'::jsonb),
    'availability', coalesce((
      select jsonb_agg(jsonb_build_object('staff_id', av.staff_id, 'date', av.date, 'status', av.status))
      from public.availability av join public.staff s on s.id = av.staff_id
      where av.date between m_start and m_end and s.status = 'active'
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'kana', s.kana, 'nearest_station', s.nearest_station,
        'rank_name', r.name, 'rank_order', r.sort_order
      ))
      from public.staff s left join public.ranks r on r.id = s.rank_id
      where s.status = 'active'
         or exists (
           select 1 from public.assignments a join public.events e on e.id = a.event_id
            where a.staff_id = s.id and a.status = 'confirmed' and e.cancelled_at is null and e.date between m_start and m_end
         )
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.share_board(text, date) to anon;
