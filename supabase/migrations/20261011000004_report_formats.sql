-- =============================================================================
-- Phase 4-1: 日報のフォーマット（取引先ごとの LINE 用の書式）
--
-- 集めた実績報告（件数・コメント）を、取引先ごとの書式の文章にして LINE にコピーできるようにする。
-- 書式は「はじめ」「現場ごと」「1人ごと」「おわり」の4つに分けて持ち、{名前} などの差し込みを使う（src/lib/report-format.ts）。
-- 金額は扱わない（差し込みにも入れない）。
-- =============================================================================

create table public.report_formats (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  -- 使う取引先（空ならすべての取引先）
  company_id uuid references public.companies (id),
  -- スタッフのマイページにも「LINE用にコピー」を出すか
  for_staff boolean not null default true,
  header text not null default '',
  event_block text not null default '',
  person_block text not null default '',
  footer text not null default '',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index report_formats_company_idx on public.report_formats (company_id);
create trigger report_formats_updated_at before update on public.report_formats
  for each row execute function public.set_updated_at();

alter table public.report_formats enable row level security;
create policy "report_formats: 読むのはメンバー" on public.report_formats
  for select to authenticated using ((select public.is_member()));
create policy "report_formats: 足すのはオーナー" on public.report_formats
  for insert to authenticated with check ((select public.is_owner()));
create policy "report_formats: 直すのはオーナー" on public.report_formats
  for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));

-- 初めから1つ入れておく（オーナーが設定画面で直す）
insert into public.report_formats (name, for_staff, header, event_block, person_block, footer, sort_order) values (
  'NICOLY用', true,
  E'【日報】{日付}（{曜日}）{取引先}',
  E'■{会場}',
  E'{名前}（{役割}）\n{件数一覧}\n{コメント}',
  E'',
  0
);

-- -----------------------------------------------------------------------------
-- マイページの報告: 本人の名前・取引先の名前と、使える書式を足す（本人の分だけ。金額は返さない）
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
        jsonb_build_object('id', f.id, 'name', f.name, 'header', f.header, 'event_block', f.event_block, 'person_block', f.person_block, 'footer', f.footer)
        order by (f.company_id is null), f.sort_order, f.name
      )
      from public.report_formats f
      where f.is_active and f.for_staff and (f.company_id is null or f.company_id = ev.client_id)
    ), '[]'::jsonb)
  );
end;
$$;
