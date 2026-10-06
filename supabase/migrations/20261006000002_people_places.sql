-- =============================================================================
-- スタッフ・会場・会社（取引先 / 協力会社）
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 会場
-- -----------------------------------------------------------------------------

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  kana text not null default '',
  -- 「テレアポ」など会場以外の稼働も会場として登録するため、住所は空でもよい
  address text not null default '',
  nearest_station text not null default '',
  prefecture text not null default '',
  area_id uuid references public.areas (id),
  access_notes text not null default '',  -- 入館方法
  green_room text not null default '',    -- 控室
  parking text not null default '',       -- 駐車場
  memo text not null default '',
  is_active boolean not null default true,
  search_text text generated always as (
    public.search_norm(name || ' ' || kana || ' ' || address || ' ' || nearest_station)
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index venues_area_idx on public.venues (area_id);
create trigger venues_updated_at before update on public.venues
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 会社（取引先 / 協力会社）
-- -----------------------------------------------------------------------------

create type public.company_kind as enum ('client', 'partner');
create type public.company_status as enum (
  'not_contacted', -- 未接触
  'contacted',     -- 接触済み
  'meeting_set',   -- 商談設定
  'met',           -- 商談済み
  'active',        -- 取引中
  'dormant'        -- 見送り・休眠
);
create type public.priority as enum ('high', 'mid', 'low');

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  kind public.company_kind not null,
  name text not null check (length(trim(name)) > 0),
  kana text not null default '',
  name_key text generated always as (public.company_key(name)) stored,
  phone text not null default '',
  phone_digits text generated always as (public.digits_only(phone)) stored,
  address text not null default '',
  website text not null default '',
  status public.company_status not null default 'not_contacted',
  priority public.priority not null default 'mid',
  owner_user_id uuid references public.app_users (id),
  next_action_date date,
  next_action text not null default '',
  memo text not null default '',
  is_active boolean not null default true,
  search_text text generated always as (
    public.search_norm(name || ' ' || kana)
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index companies_kind_idx on public.companies (kind, is_active);
create index companies_name_key_idx on public.companies (name_key);
create index companies_next_action_idx on public.companies (next_action_date);
create trigger companies_updated_at before update on public.companies
  for each row execute function public.set_updated_at();

-- 先方の担当者
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  name text not null check (length(trim(name)) > 0),
  kana text not null default '',
  title text not null default '',  -- 役職
  phone text not null default '',
  phone_digits text generated always as (public.digits_only(phone)) stored,
  email text not null default '',
  line text not null default '',
  memo text not null default '',
  is_active boolean not null default true,
  search_text text generated always as (
    public.search_norm(name || ' ' || kana)
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contacts_company_idx on public.contacts (company_id);
create trigger contacts_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();

-- 活動履歴（Phase 2 で画面を作る）
create type public.activity_kind as enum ('call', 'line', 'email', 'visit', 'meeting', 'other');
create type public.activity_result as enum (
  'reached',        -- つながった
  'absent',         -- 不在
  'callback',       -- 折り返し待ち
  'sent_material',  -- 資料送付
  'appointment',    -- アポ獲得
  'declined'        -- 見送り
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  contact_id uuid references public.contacts (id),
  user_id uuid references public.app_users (id) default auth.uid(),
  kind public.activity_kind not null,
  result public.activity_result,
  memo text not null default '',
  occurred_at timestamptz not null default now(),
  next_action_date date,
  next_action text not null default '',
  created_at timestamptz not null default now()
);

create index activities_company_idx on public.activities (company_id, occurred_at desc);

-- 関連資料のリンク
create table public.company_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  title text not null default '',
  url text not null check (url ~* '^https?://'),
  created_at timestamptz not null default now()
);

create index company_links_company_idx on public.company_links (company_id);

-- 取引先ごとに使う獲得項目（Phase 0 決定3）。行がない取引先は有効な全項目を使う
create table public.company_items (
  company_id uuid not null references public.companies (id),
  item_id uuid not null references public.items (id),
  primary key (company_id, item_id)
);

-- -----------------------------------------------------------------------------
-- スタッフ
-- -----------------------------------------------------------------------------

create type public.staff_status as enum ('active', 'paused', 'ended'); -- 稼働中 / 休止 / 終了

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  kana text not null default '',
  phone text not null default '',
  phone_digits text generated always as (public.digits_only(phone)) stored,
  line_name text not null default '',
  nearest_station text not null default '',
  rank_id uuid references public.ranks (id),
  status public.staff_status not null default 'active',
  memo text not null default '',
  mypage_token text not null unique default public.new_mypage_token(),
  token_rotated_at timestamptz,
  -- 将来 LINE 公式アカウントから送るときに使う（今は空）
  line_user_id text,
  search_text text generated always as (
    public.search_norm(name || ' ' || kana || ' ' || line_name)
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index staff_status_idx on public.staff (status);
create index staff_phone_idx on public.staff (phone_digits);
create trigger staff_updated_at before update on public.staff
  for each row execute function public.set_updated_at();

create table public.staff_roles (
  staff_id uuid not null references public.staff (id),
  role_id uuid not null references public.roles (id),
  primary key (staff_id, role_id)
);
create index staff_roles_role_idx on public.staff_roles (role_id);

create table public.staff_areas (
  staff_id uuid not null references public.staff (id),
  area_id uuid not null references public.areas (id),
  primary key (staff_id, area_id)
);
create index staff_areas_area_idx on public.staff_areas (area_id);

-- NG（会場NG・取引先NG）
create table public.staff_ng (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id),
  venue_id uuid references public.venues (id),
  company_id uuid references public.companies (id),
  reason text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (num_nonnulls(venue_id, company_id) = 1)
);
create unique index staff_ng_venue_uniq on public.staff_ng (staff_id, venue_id) where venue_id is not null;
create unique index staff_ng_company_uniq on public.staff_ng (staff_id, company_id) where company_id is not null;

-- 稼働履歴メモ
create type public.note_kind as enum (
  'last_minute_cancel', -- 直前キャンセル
  'late',               -- 遅延
  'trouble',            -- トラブル
  'good',               -- 良かった点
  'other'               -- その他
);

create table public.staff_notes (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff (id),
  date date not null default public.jst_today(),
  kind public.note_kind not null,
  memo text not null default '',
  is_auto boolean not null default false,
  assignment_id uuid,  -- 自動記録の元になったアサイン（FK は assignments 作成後に追加）
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index staff_notes_staff_idx on public.staff_notes (staff_id, date desc);

-- 稼働可能日（未入力は行なし）
create type public.availability_status as enum ('ok', 'maybe', 'ng'); -- ○ / △ / ×
create type public.input_source as enum ('self', 'admin');            -- 本人 / 管理者

create table public.availability (
  staff_id uuid not null references public.staff (id),
  date date not null,
  status public.availability_status not null,
  source public.input_source not null default 'admin',
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (staff_id, date)
);
create index availability_date_idx on public.availability (date);

-- 月ごとの提出（提出済み / 未提出の判定とメモ）
create table public.availability_submissions (
  staff_id uuid not null references public.staff (id),
  month date not null check (month = date_trunc('month', month)::date),
  memo text not null default '',
  submitted_at timestamptz,
  source public.input_source not null default 'admin',
  updated_at timestamptz not null default now(),
  primary key (staff_id, month)
);

create trigger availability_submissions_updated_at before update on public.availability_submissions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS: オーナー・管理者は読み書きできる（削除は個別に許可）
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'venues', 'companies', 'contacts', 'activities', 'company_links', 'company_items',
    'staff', 'staff_roles', 'staff_areas', 'staff_ng', 'staff_notes',
    'availability', 'availability_submissions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "%s: 利用者は読める" on public.%I for select to authenticated using ((select public.is_member()))', t, t);
    execute format(
      'create policy "%s: 利用者が追加" on public.%I for insert to authenticated with check ((select public.is_member()))', t, t);
    execute format(
      'create policy "%s: 利用者が変更" on public.%I for update to authenticated using ((select public.is_member())) with check ((select public.is_member()))', t, t);
  end loop;

  -- 付け外しする設定（履歴ではない）だけ削除を許可
  foreach t in array array[
    'company_links', 'company_items', 'staff_roles', 'staff_areas', 'staff_ng', 'availability'
  ] loop
    execute format(
      'create policy "%s: 利用者が削除" on public.%I for delete to authenticated using ((select public.is_member()))', t, t);
  end loop;
end;
$$;
