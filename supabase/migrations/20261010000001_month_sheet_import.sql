-- =============================================================================
-- Phase 1.5: 月のシートの取り込み
--
-- シートから取り込んだ過去の日の現場は「記録のみ」（実績報告なし）にする。
-- 取り込む前の稼働には報告がないので、ホーム・実績確認・マイページに「未報告」として出さない。
-- 後から獲得件数の記録を取り込む（Phase 2）ときも、この現場とアサインに付ける。
-- =============================================================================

alter table public.events add column report_required boolean not null default true;
comment on column public.events.report_required is '実績報告が必要か。false = シートから取り込んだ過去の記録（記録のみ）';

-- events の列が増えたので作り直す（e.* は作ったときの列で固定されるため）
drop view public.event_overview;

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
         count(*) filter (where a.status = 'confirmed' and ev.report_required and (r.assignment_id is null or r.submitted_at is null))::int as unreported_count,
         count(*) filter (where a.status = 'confirmed' and ev.report_required and (r.confirmed_at is null))::int as unconfirmed_result_count,
         count(*) filter (where a.status = 'confirmed' and a.confirm_notice_sent_at is null)::int as confirm_notice_pending,
         count(*) filter (where a.status = 'confirmed' and a.reminder_sent_at is null)::int as reminder_pending
    from public.assignments a
    join public.events ev on ev.id = a.event_id
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
    when e.date < public.jst_today() and not e.report_required then 'done'
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

-- マイページ: 記録のみの現場は報告の対象にしない
create or replace function public.mypage_me(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ms record;
  s public.staff;
  err text;
  win integer := public.setting_int('report_window_days', 7);
begin
  select * into ms from public.mypage_staff(p_token);
  s := ms.staff;
  err := ms.error;
  if err is not null then return jsonb_build_object('error', err); end if;
  return jsonb_build_object(
    'name', s.name,
    'offers', (
      select count(*) from public.assignments a join public.events e on e.id = a.event_id
       where a.staff_id = s.id and a.status = 'offered' and e.date >= public.jst_today() and e.cancelled_at is null
    ),
    'reports', (
      select count(*) from public.assignments a
        join public.events e on e.id = a.event_id
        left join public.reports r on r.assignment_id = a.id
       where a.staff_id = s.id and a.status = 'confirmed' and e.cancelled_at is null and e.report_required
         and e.date <= public.jst_today() and e.date >= public.jst_today() - win
         and r.submitted_at is null
    )
  );
end;
$$;

create or replace function public.mypage_reports(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ms record;
  s public.staff;
  err text;
  win integer := public.setting_int('report_window_days', 7);
begin
  select * into ms from public.mypage_staff(p_token);
  s := ms.staff;
  err := ms.error;
  if err is not null then return jsonb_build_object('error', err); end if;
  return jsonb_build_object(
    'window_days', win,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'assignment_id', a.id,
          'role', ro.name,
          'submitted_at', r.submitted_at,
          'confirmed', r.confirmed_at is not null,
          'deadline', e.date + win,
          'event', public.mypage_event_json(a.event_id)
        )
        order by e.date desc
      )
      from public.assignments a
      join public.events e on e.id = a.event_id
      join public.roles ro on ro.id = a.role_id
      left join public.reports r on r.assignment_id = a.id
      where a.staff_id = s.id and a.status = 'confirmed' and e.cancelled_at is null and e.report_required
        and e.date <= public.jst_today() and e.date >= public.jst_today() - win
    ), '[]'::jsonb)
  );
end;
$$;
