-- =============================================================================
-- ★ 金額系テーブル（オーナーのみ）
-- 管理者からは RLS で 0 件になる。テーブルを追加・変更したら tests/db/rls.test.ts に足すこと
-- =============================================================================

-- スタッフのお金・個人情報
create type public.withholding_method as enum ('none', 'fee', 'sales_agent'); -- なし / 報酬・料金 / 外交員報酬
create type public.account_type as enum ('ordinary', 'checking');             -- 普通 / 当座

create table public.staff_private (
  staff_id uuid primary key references public.staff (id),
  base_daily_rate integer check (base_daily_rate >= 0),
  withholding_method public.withholding_method not null default 'none',
  invoice_number text check (invoice_number is null or invoice_number ~ '^T[0-9]{13}$'),
  contract_date date,
  contract_file_path text,
  bank_name text not null default '',
  bank_branch text not null default '',
  account_type public.account_type,
  account_number text not null default '',
  account_holder_kana text not null default '',
  updated_at timestamptz not null default now()
);

create trigger staff_private_updated_at before update on public.staff_private
  for each row execute function public.set_updated_at();

-- ランクごとの基準日当（Phase 0 決定2）。スタッフ登録・取り込み時の初期値に使う
create table public.rank_rates (
  rank_id uuid primary key references public.ranks (id),
  base_daily_rate integer not null check (base_daily_rate >= 0)
);

-- 取引先の請求設定
create table public.company_billing (
  company_id uuid primary key references public.companies (id),
  closing_day integer not null default 0 check (closing_day between 0 and 31), -- 0 = 末日
  invoice_note text not null default '',
  bill_transport boolean not null default false,
  updated_at timestamptz not null default now()
);

create trigger company_billing_updated_at before update on public.company_billing
  for each row execute function public.set_updated_at();

-- 単価（人日 / 現場固定 / 成果）
create type public.rate_kind as enum ('per_person_day', 'per_event', 'per_item');

-- 取引先の標準単価。venue_id があれば「取引先×会場」の標準（Phase 0 決定4）
create table public.client_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  venue_id uuid references public.venues (id),
  kind public.rate_kind not null,
  role_id uuid references public.roles (id),
  item_id uuid references public.items (id),
  amount integer not null check (amount >= 0),
  check (
    (kind = 'per_person_day' and role_id is not null and item_id is null)
    or (kind = 'per_event' and role_id is null and item_id is null)
    or (kind = 'per_item' and role_id is null and item_id is not null)
  ),
  unique nulls not distinct (company_id, venue_id, kind, role_id, item_id)
);

-- 現場ごとの上書き
create table public.event_rates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id),
  kind public.rate_kind not null,
  role_id uuid references public.roles (id),
  item_id uuid references public.items (id),
  amount integer not null check (amount >= 0),
  check (
    (kind = 'per_person_day' and role_id is not null and item_id is null)
    or (kind = 'per_event' and role_id is null and item_id is null)
    or (kind = 'per_item' and role_id is null and item_id is not null)
  ),
  unique nulls not distinct (event_id, kind, role_id, item_id)
);

-- インセンティブ単価（全体標準）と現場ごとの上書き
create table public.incentive_rates (
  item_id uuid primary key references public.items (id),
  amount integer not null check (amount >= 0)
);

create table public.event_incentive_rates (
  event_id uuid not null references public.events (id),
  item_id uuid not null references public.items (id),
  amount integer not null check (amount >= 0),
  primary key (event_id, item_id)
);

-- 日当の上書き（アサインごと）
create table public.assignment_private (
  assignment_id uuid primary key references public.assignments (id),
  daily_rate_override integer check (daily_rate_override >= 0)
);

-- 調整額（理由必須）
create table public.payment_adjustments (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id),
  month date not null check (month = date_trunc('month', month)::date),
  amount integer not null,
  reason text not null check (length(trim(reason)) > 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index payment_adjustments_staff_month_idx on public.payment_adjustments (staff_id, month);

-- 月次締め
create type public.closing_status as enum ('closed', 'unlocked');
create type public.closing_action as enum ('close', 'unlock', 'reclose');

create table public.monthly_closings (
  month date primary key check (month = date_trunc('month', month)::date),
  status public.closing_status not null,
  closed_at timestamptz,
  closed_by uuid references public.app_users (id)
);

create table public.closing_logs (
  id uuid primary key default gen_random_uuid(),
  month date not null references public.monthly_closings (month),
  action public.closing_action not null,
  reason text not null default '',
  user_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- 支払い・請求（締め時のスナップショット）
create type public.payment_status as enum ('unconfirmed', 'confirmed', 'paid');

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id),
  month date not null check (month = date_trunc('month', month)::date),
  daily_total integer not null default 0,
  incentive_total integer not null default 0,
  adjustment_total integer not null default 0,
  expense_total integer not null default 0,
  withholding_base integer not null default 0,
  withholding_amount integer not null default 0,
  net_amount integer not null default 0,
  status public.payment_status not null default 'unconfirmed',
  paid_on date,
  detail jsonb not null default '[]'::jsonb,
  snapshot_at timestamptz not null default now(),
  unique (staff_id, month)
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  month date not null check (month = date_trunc('month', month)::date),
  subtotal integer not null default 0,
  tax integer not null default 0,
  total integer not null default 0,
  detail jsonb not null default '[]'::jsonb,
  snapshot_at timestamptz not null default now(),
  unique (company_id, month)
);

-- 金額・税の設定、月次目標
create table public.owner_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create trigger owner_settings_updated_at before update on public.owner_settings
  for each row execute function public.set_updated_at();

create table public.monthly_targets (
  month date primary key check (month = date_trunc('month', month)::date),
  revenue integer check (revenue >= 0),
  gross_profit integer
);

-- -----------------------------------------------------------------------------
-- RLS: オーナーだけ（管理者は 0 件）
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'staff_private', 'rank_rates', 'company_billing', 'client_rates', 'event_rates',
    'incentive_rates', 'event_incentive_rates', 'assignment_private', 'payment_adjustments',
    'monthly_closings', 'closing_logs', 'payments', 'invoices', 'owner_settings', 'monthly_targets'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "%s: オーナーのみ" on public.%I for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))', t, t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 契約書PDF（非公開バケット、オーナーのみ）
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contracts', 'contracts', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create policy "contracts: オーナーが読める" on storage.objects
  for select to authenticated using (bucket_id = 'contracts' and (select public.is_owner()));
create policy "contracts: オーナーが追加" on storage.objects
  for insert to authenticated with check (bucket_id = 'contracts' and (select public.is_owner()));
create policy "contracts: オーナーが変更" on storage.objects
  for update to authenticated
  using (bucket_id = 'contracts' and (select public.is_owner()))
  with check (bucket_id = 'contracts' and (select public.is_owner()));
create policy "contracts: オーナーが削除" on storage.objects
  for delete to authenticated using (bucket_id = 'contracts' and (select public.is_owner()));
