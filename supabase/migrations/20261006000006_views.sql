-- =============================================================================
-- 計算で出すもの（ビュー・関数）。ビューは必ず security_invoker（RLS をすり抜けない）
-- =============================================================================

-- 現場ごとの人数・欠員・表示用ステータス
create view public.event_overview
with (security_invoker = true)
as
with req as (
  select r.event_id, r.role_id, r.required_count,
         count(a.id) filter (where a.status = 'confirmed') as confirmed_count
    from public.event_requirements r
    left join public.assignments a on a.event_id = r.event_id and a.role_id = r.role_id
   group by r.event_id, r.role_id, r.required_count
),
req_sum as (
  select event_id,
         sum(required_count)::int as required_total,
         sum(greatest(required_count - confirmed_count, 0))::int as shortage_total,
         jsonb_object_agg(role_id, jsonb_build_object(
           'required', required_count,
           'confirmed', confirmed_count,
           'shortage', greatest(required_count - confirmed_count, 0)
         )) as by_role
    from req
   group by event_id
),
asg as (
  select a.event_id,
         count(*) filter (where a.status = 'confirmed')::int as confirmed_total,
         count(*) filter (where a.status = 'offered')::int as offered_count,
         count(*) filter (where a.status = 'waitlisted')::int as waitlisted_count,
         min(a.offered_at) filter (where a.status = 'offered') as oldest_offer_at,
         count(*) filter (where a.status = 'confirmed' and (r.assignment_id is null or r.submitted_at is null))::int as unreported_count,
         count(*) filter (where a.status = 'confirmed' and (r.confirmed_at is null))::int as unconfirmed_result_count,
         count(*) filter (where a.status = 'confirmed' and a.confirm_notice_sent_at is null)::int as confirm_notice_pending,
         count(*) filter (where a.status = 'confirmed' and a.reminder_sent_at is null)::int as reminder_pending
    from public.assignments a
    left join public.reports r on r.assignment_id = a.id
   group by a.event_id
)
select
  e.*,
  coalesce(rs.required_total, 0) as required_total,
  coalesce(asg.confirmed_total, 0) as confirmed_total,
  coalesce(rs.shortage_total, 0) as shortage_total,
  coalesce(rs.by_role, '{}'::jsonb) as by_role,
  coalesce(asg.offered_count, 0) as offered_count,
  coalesce(asg.waitlisted_count, 0) as waitlisted_count,
  asg.oldest_offer_at,
  coalesce(asg.unreported_count, 0) as unreported_count,
  coalesce(asg.unconfirmed_result_count, 0) as unconfirmed_result_count,
  coalesce(asg.confirm_notice_pending, 0) as confirm_notice_pending,
  coalesce(asg.reminder_pending, 0) as reminder_pending,
  case
    when e.cancelled_at is not null then 'cancelled'
    when public.is_month_closed(e.date) then 'closed'
    when e.date < public.jst_today()
         and coalesce(asg.confirmed_total, 0) > 0
         and coalesce(asg.unconfirmed_result_count, 0) = 0 then 'results_confirmed'
    when e.date < public.jst_today() then 'done'
    when coalesce(rs.required_total, 0) > 0 and coalesce(rs.shortage_total, 0) = 0 then 'staffed'
    else 'planned'
  end as status
from public.events e
left join req_sum rs on rs.event_id = e.id
left join asg on asg.event_id = e.id;

-- スタッフ別の平均獲得件数（確定ベース、指定日以降の稼働）
-- 1稼働あたりの確定件数の合計の平均
create or replace function public.staff_avg_confirmed(p_since date)
returns table (staff_id uuid, worked_count integer, avg_confirmed numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.staff_id,
         count(*)::int,
         round(avg(t.total), 1)
    from public.assignments a
    join public.events e on e.id = a.event_id
    join public.reports r on r.assignment_id = a.id and r.confirmed_at is not null
    join lateral (
      select coalesce(sum(ri.confirmed_count), 0) as total
        from public.report_items ri where ri.assignment_id = a.id
    ) t on true
   where a.status = 'confirmed'
     and e.date >= p_since
     and e.date <= public.jst_today()
   group by a.staff_id
$$;

-- 候補一覧（要件 §4.3）。並び順: ○ → △ → 未提出 → ×・NG・ダブルブッキング、同順位はランク → 平均獲得件数
create or replace function public.event_candidates(p_event_id uuid)
returns table (
  staff_id uuid,
  name text,
  kana text,
  nearest_station text,
  rank_id uuid,
  rank_name text,
  rank_order integer,
  role_ids uuid[],
  area_match boolean,
  availability public.availability_status,
  availability_submitted boolean,
  double_booking boolean,
  double_booking_venue text,
  ng_venue boolean,
  ng_client boolean,
  ng_reason text,
  avg_confirmed numeric,
  caution_count integer,
  current_status public.assignment_status,
  sort_group integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with ev as (
    select e.id, e.date, e.client_id, e.venue_id, v.area_id
      from public.events e join public.venues v on v.id = e.venue_id
     where e.id = p_event_id
  ),
  avgs as (
    select * from public.staff_avg_confirmed(((select date from ev) - interval '3 months')::date)
  ),
  base as (
    select
      s.id as staff_id, s.name, s.kana, s.nearest_station, s.rank_id,
      rk.name as rank_name, rk.sort_order as rank_order,
      coalesce((select array_agg(sr.role_id) from public.staff_roles sr where sr.staff_id = s.id), '{}') as role_ids,
      exists (select 1 from public.staff_areas sa where sa.staff_id = s.id and sa.area_id = ev.area_id) as area_match,
      av.status as availability,
      exists (
        select 1 from public.availability_submissions sub
         where sub.staff_id = s.id and sub.month = public.month_start(ev.date) and sub.submitted_at is not null
      ) as availability_submitted,
      db.venue_name as double_booking_venue,
      exists (select 1 from public.staff_ng n where n.staff_id = s.id and n.venue_id = ev.venue_id) as ng_venue,
      exists (select 1 from public.staff_ng n where n.staff_id = s.id and n.company_id = ev.client_id) as ng_client,
      (select string_agg(nullif(n.reason, ''), ' / ') from public.staff_ng n
        where n.staff_id = s.id and (n.venue_id = ev.venue_id or n.company_id = ev.client_id)) as ng_reason,
      avgs.avg_confirmed,
      (select count(*)::int from public.staff_notes sn
        where sn.staff_id = s.id
          and sn.kind in ('last_minute_cancel', 'late', 'trouble')
          and sn.date >= (public.jst_today() - interval '6 months')::date) as caution_count,
      cur.status as current_status
    from public.staff s
    cross join ev
    left join public.ranks rk on rk.id = s.rank_id
    left join public.availability av on av.staff_id = s.id and av.date = ev.date
    left join avgs on avgs.staff_id = s.id
    left join public.assignments cur on cur.event_id = ev.id and cur.staff_id = s.id
    left join lateral (
      select v2.name as venue_name
        from public.assignments a2
        join public.events e2 on e2.id = a2.event_id
        join public.venues v2 on v2.id = e2.venue_id
       where a2.staff_id = s.id
         and e2.date = ev.date
         and e2.id <> ev.id
         and e2.cancelled_at is null
         and a2.status in ('offered', 'confirmed', 'waitlisted')
       limit 1
    ) db on true
    where s.status = 'active'
  )
  select
    b.staff_id, b.name, b.kana, b.nearest_station, b.rank_id, b.rank_name, b.rank_order,
    b.role_ids, b.area_match, b.availability, b.availability_submitted,
    b.double_booking_venue is not null as double_booking, b.double_booking_venue,
    b.ng_venue, b.ng_client, b.ng_reason, b.avg_confirmed, b.caution_count, b.current_status,
    case
      when b.availability = 'ng' or b.ng_venue or b.ng_client or b.double_booking_venue is not null then 3
      when b.availability = 'ok' then 0
      when b.availability = 'maybe' then 1
      else 2
    end as sort_group
  from base b
  order by sort_group, b.rank_order nulls last, b.avg_confirmed desc nulls last, b.kana, b.name
$$;
