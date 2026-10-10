-- =============================================================================
-- Phase 1.5: 稼働表をスプレッドシートへ自動で書き出す
--
-- 書き出しはログインしていない処理（10分ごとの自動実行）から動くので、秘密キーで DB を読む。
-- ただし読むのは board_snapshot()（見るだけリンクと同じ、金額・電話番号のない内容）だけにする。
-- =============================================================================

-- 稼働表の中身（見るだけリンク・書き出しで共通。単体では誰も実行できない）
create or replace function public.board_json(m_start date, m_end date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
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

revoke execute on function public.board_json(date, date) from public, anon, authenticated;

-- 見るだけリンク: 鍵を確かめてから board_json を返す（中身は前のマイグレーションと同じ）
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
    perform public.rate_limit_hit('share:invalid', 300);
    return jsonb_build_object('error', 'invalid_token');
  end if;
  if not public.rate_limit_hit('share:board', 600) then
    return jsonb_build_object('error', 'rate_limited');
  end if;
  if p_month is null or m_start < (cur - interval '1 month')::date or m_start > (cur + interval '3 month')::date then
    return jsonb_build_object('error', 'out_of_range');
  end if;
  return public.board_json(m_start, m_end);
end;
$$;

-- 書き出し用（秘密キー＝service_role だけが実行できる）
create or replace function public.board_snapshot(p_month date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.board_json(date_trunc('month', p_month)::date, (date_trunc('month', p_month) + interval '1 month - 1 day')::date)
$$;

revoke execute on function public.board_snapshot(date) from public, anon, authenticated;
grant execute on function public.board_snapshot(date) to service_role;

-- 書き出しの記録（いつ・成功したか）。書くのは書き出しの処理（秘密キー）だけ
create table public.sheet_exports (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  ok boolean not null,
  message text not null default '',
  source text not null check (source in ('cron', 'button'))
);

alter table public.sheet_exports enable row level security;

create policy sheet_exports_select on public.sheet_exports
  for select to authenticated using (public.is_member());
