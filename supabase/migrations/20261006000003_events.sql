-- =============================================================================
-- 現場・アサイン・実績・交通費経費
-- =============================================================================

-- 一括作成のまとまり
create table public.event_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- 現場（1日 × 1会場）。ステータスは保存せず event_overview で計算する（中止だけ保存）
create table public.events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.companies (id),
  venue_id uuid not null references public.venues (id),
  date date not null,
  start_time time,
  end_time time,
  meeting_time time,
  meeting_place text not null default '',
  belongings text not null default '',  -- 服装・持ち物
  notes text not null default '',       -- 注意事項
  group_id uuid references public.event_groups (id),
  cancelled_at timestamptz,
  cancel_reason text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index events_date_idx on public.events (date);
create index events_client_date_idx on public.events (client_id, date);
create index events_venue_date_idx on public.events (venue_id, date);
create index events_group_idx on public.events (group_id);
create trigger events_updated_at before update on public.events
  for each row execute function public.set_updated_at();

-- 現場の取引先は「取引先」の会社だけ
create or replace function public.check_event_client()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.companies where id = new.client_id and kind = 'client') then
    raise exception '現場の取引先には「取引先」の会社を選んでください' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger events_check_client before insert or update of client_id on public.events
  for each row execute function public.check_event_client();

-- 役割別の必要人数
create table public.event_requirements (
  event_id uuid not null references public.events (id),
  role_id uuid not null references public.roles (id),
  required_count integer not null check (required_count >= 0),
  primary key (event_id, role_id)
);

-- アサイン
create type public.assignment_status as enum (
  'offered',     -- 打診中
  'confirmed',   -- 確定
  'waitlisted',  -- 補欠
  'declined',    -- 辞退
  'cancelled',   -- キャンセル（確定後に取りやめ）
  'no_show'      -- 当日不稼働
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id),
  staff_id uuid not null references public.staff (id),
  role_id uuid not null references public.roles (id),
  status public.assignment_status not null default 'offered',
  offered_at timestamptz not null default now(),
  responded_at timestamptz,
  response_source public.input_source,
  confirm_notice_sent_at timestamptz,
  reminder_sent_at timestamptz,
  cancel_reason_code text,
  cancel_reason text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, staff_id)
);

create index assignments_staff_idx on public.assignments (staff_id);
create index assignments_event_status_idx on public.assignments (event_id, status);
create trigger assignments_updated_at before update on public.assignments
  for each row execute function public.set_updated_at();

alter table public.staff_notes
  add constraint staff_notes_assignment_fk foreign key (assignment_id) references public.assignments (id);

-- 実績報告（スタッフ1人 × 現場1つ）。確定は管理者が行う
create table public.reports (
  assignment_id uuid primary key references public.assignments (id),
  comment text not null default '',
  submitted_at timestamptz,
  source public.input_source not null default 'self',
  confirmed_at timestamptz,
  confirmed_by uuid references public.app_users (id),
  updated_at timestamptz not null default now()
);

create trigger reports_updated_at before update on public.reports
  for each row execute function public.set_updated_at();

-- 獲得件数（速報 / 確定）
create type public.diff_reason as enum ('cancelled', 'rejected', 'input_error', 'other'); -- キャンセル / 否認 / 入力ミス / その他

create table public.report_items (
  assignment_id uuid not null references public.assignments (id),
  item_id uuid not null references public.items (id),
  reported_count integer check (reported_count >= 0),   -- 速報
  confirmed_count integer check (confirmed_count >= 0), -- 確定
  diff_reason public.diff_reason,
  diff_note text not null default '',
  primary key (assignment_id, item_id),
  -- 速報と確定が違うときは理由が必須（速報がない＝管理者が直接入力した場合は不要）
  check (
    confirmed_count is null
    or reported_count is null
    or confirmed_count = reported_count
    or diff_reason is not null
  ),
  check (diff_reason is distinct from 'other' or length(trim(diff_note)) > 0)
);

-- 交通費・経費（申請額は管理者も見て承認できる。要件 §3）
create type public.expense_kind as enum ('transport', 'other');
create type public.expense_status as enum ('pending', 'approved', 'rejected');

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id),
  staff_id uuid not null references public.staff (id),
  kind public.expense_kind not null,
  amount integer not null check (amount >= 0),
  memo text not null default '',
  status public.expense_status not null default 'pending',
  source public.input_source not null default 'self',
  reviewed_by uuid references public.app_users (id),
  reviewed_at timestamptz,
  reject_reason text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, kind)
);

create index expenses_status_idx on public.expenses (status);
create index expenses_staff_idx on public.expenses (staff_id);
create trigger expenses_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();

-- staff_id はアサインから自動で入れる（食い違いを防ぐ）
create or replace function public.expenses_fill_staff()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select staff_id into new.staff_id from public.assignments where id = new.assignment_id;
  return new;
end;
$$;

create trigger expenses_fill_staff before insert or update of assignment_id on public.expenses
  for each row execute function public.expenses_fill_staff();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'event_groups', 'events', 'event_requirements', 'assignments', 'reports', 'report_items', 'expenses'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "%s: 利用者は読める" on public.%I for select to authenticated using ((select public.is_member()))', t, t);
    execute format(
      'create policy "%s: 利用者が追加" on public.%I for insert to authenticated with check ((select public.is_member()))', t, t);
    execute format(
      'create policy "%s: 利用者が変更" on public.%I for update to authenticated using ((select public.is_member())) with check ((select public.is_member()))', t, t);
  end loop;
end;
$$;

-- 必要人数の行は付け外しする設定
create policy "event_requirements: 利用者が削除" on public.event_requirements
  for delete to authenticated using ((select public.is_member()));

-- 打診の取り消し（元に戻す）だけ削除を許可。回答や実績が付いたものは消せない
create policy "assignments: 打診中だけ削除" on public.assignments
  for delete to authenticated
  using (
    (select public.is_member())
    and status = 'offered'
    and responded_at is null
    and not exists (select 1 from public.reports r where r.assignment_id = assignments.id)
  );
