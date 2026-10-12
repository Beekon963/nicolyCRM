-- =============================================================================
-- Phase 8-7: 稼働開始の報告（「稼働します」）
--
-- NextWave のルール「稼働開始時は、現場名と稼働者名を記載し、『稼働します』と報告」のため、
-- 日報のフォーマットに「稼働開始の報告」の文面（start_block）を足す。空なら出さない。
-- スタッフは当日、マイページから現場名・稼働者（同じ現場の全員）を入れた文をコピーして LINE に送る。
-- 金額は扱わない。
-- =============================================================================

alter table public.report_formats add column start_block text not null default '';

-- もう作ってある NextWave の書式（見本から作ったもの）には、見本の文を入れておく
update public.report_formats
   set start_block = E'{会場}\n稼働者：{稼働者}\n稼働します'
 where start_block = '' and event_block like '%ネクストウェーブ報告フォーマット%';

-- -----------------------------------------------------------------------------
-- マイページの報告: 書式に start_block を足す（ほかは 20261012000003 と同じ）
-- -----------------------------------------------------------------------------

create or replace function public.mypage_report_get(p_token text, p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ms record;
  s public.staff;
  err text;
  a public.assignments;
  ev public.events;
  r public.reports;
  win integer := public.setting_int('report_window_days', 7);
  has_company_items boolean;
begin
  select * into ms from public.mypage_staff(p_token);
  s := ms.staff;
  err := ms.error;
  if err is not null then return jsonb_build_object('error', err); end if;
  select * into a from public.assignments where id = p_assignment_id and staff_id = s.id;
  if not found or a.status <> 'confirmed' then return jsonb_build_object('error', 'not_found'); end if;
  select * into ev from public.events where id = a.event_id;
  select * into r from public.reports where assignment_id = a.id;
  select exists (select 1 from public.company_items where company_id = ev.client_id) into has_company_items;

  return jsonb_build_object(
    'event', public.mypage_event_json(ev.id),
    'role', (select name from public.roles where id = a.role_id),
    'staff_name', s.name,
    'client_name', (select name from public.companies where id = ev.client_id),
    'deadline', ev.date + win,
    'editable', r.confirmed_at is null and ev.date <= public.jst_today() and public.jst_today() <= ev.date + win and ev.cancelled_at is null,
    'confirmed', r.confirmed_at is not null,
    'submitted_at', r.submitted_at,
    'comment', coalesce(r.comment, ''),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object('item_id', i.id, 'name', i.name, 'reported', ri.reported_count, 'confirmed', ri.confirmed_count)
        order by i.sort_order
      )
      from public.items i
      left join public.report_items ri on ri.assignment_id = a.id and ri.item_id = i.id
      where (i.is_active and (not has_company_items or exists (select 1 from public.company_items ci where ci.company_id = ev.client_id and ci.item_id = i.id)))
         or ri.reported_count is not null
    ), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_object_agg(x.kind, jsonb_build_object('amount', x.amount, 'memo', x.memo, 'status', x.status))
      from public.expenses x where x.assignment_id = a.id
    ), '{}'::jsonb),
    -- この現場の取引先で使う書式（取引先の専用の書式を先に）
    'formats', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', f.id, 'name', f.name, 'header', f.header, 'event_block', f.event_block, 'person_block', f.person_block, 'footer', f.footer, 'start_block', f.start_block)
        order by (f.company_id is null), f.sort_order, f.name
      )
      from public.report_formats f
      where f.is_active and f.for_staff and (f.company_id is null or f.company_id = ev.client_id)
    ), '[]'::jsonb),
    -- 言いかえ表（この取引先の分と、全取引先の分）。LINE に書いた報告を公認名称に直すときに使う
    'aliases', coalesce((
      select jsonb_agg(jsonb_build_object('alias', al.alias, 'name', i.name) order by (al.company_id is null), al.alias)
      from public.item_aliases al
      join public.items i on i.id = al.item_id
      where al.company_id is null or al.company_id = ev.client_id
    ), '[]'::jsonb),
    -- 同じ現場の全員（確定した人だけ。本人を含む）の報告。2人以上の現場は代表の1人がまとめて送る
    'coworkers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', st.name,
          'role', (select name from public.roles where id = x.role_id),
          'me', x.id = a.id,
          'submitted', rx.submitted_at is not null,
          'comment', coalesce(rx.comment, ''),
          'counts', coalesce((
            select jsonb_object_agg(i.name, coalesce(ri.confirmed_count, ri.reported_count))
            from public.report_items ri
            join public.items i on i.id = ri.item_id
            where ri.assignment_id = x.id and coalesce(ri.confirmed_count, ri.reported_count) is not null
          ), '{}'::jsonb)
        )
        order by (select sort_order from public.roles where id = x.role_id), st.kana
      )
      from public.assignments x
      join public.staff st on st.id = x.staff_id
      left join public.reports rx on rx.assignment_id = x.id
      where x.event_id = ev.id and x.status = 'confirmed'
    ), '[]'::jsonb)
  );
end;
$$;
