-- =============================================================================
-- 基盤: 拡張・共通関数・利用者（app_users）・マスタ・設定
-- 権限の方針は docs/design/security.md
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- 共通関数
-- -----------------------------------------------------------------------------

-- 日本時間の今日（サーバーは UTC で動くため必ずこれを使う）
create or replace function public.jst_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Tokyo')::date
$$;

-- 月の初日
create or replace function public.month_start(d date)
returns date
language sql
immutable
set search_path = ''
as $$
  select date_trunc('month', d)::date
$$;

-- 検索用の正規化: 全角半角をそろえ（NFKC）、ひらがな→カタカナ、小文字、空白除去
create or replace function public.search_norm(t text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(
    regexp_replace(
      translate(
        normalize(coalesce(t, ''), nfkc),
        'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔゕゖ',
        'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ'
      ),
      '\s+', '', 'g'
    )
  )
$$;

-- 電話番号などの数字だけを取り出す（ハイフン・全角数字を吸収）
create or replace function public.digits_only(t text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select regexp_replace(normalize(coalesce(t, ''), nfkc), '[^0-9]', '', 'g')
$$;

-- 会社名の重複判定用キー（「株式会社」「(株)」などの表記ゆれを吸収）
create or replace function public.company_key(t text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select public.search_norm(
    regexp_replace(
      normalize(coalesce(t, ''), nfkc),
      '株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|\(株\)|\(有\)|\(同\)|\(資\)|\(名\)|[・\.,､、。]',
      '', 'g'
    )
  )
$$;

-- マイページURL用の鍵（32バイトの乱数、URL で使える43文字）
create or replace function public.new_mypage_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=')
$$;

-- updated_at を自動更新
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 利用者（オーナー・管理者）
-- -----------------------------------------------------------------------------

create type public.user_role as enum ('owner', 'manager');

create table public.app_users (
  id uuid primary key references auth.users (id),
  name text not null check (length(trim(name)) > 0),
  email text not null,
  role public.user_role not null default 'manager',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger app_users_updated_at before update on public.app_users
  for each row execute function public.set_updated_at();

-- 有効なオーナーか（無効化は即時に効く）
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_users
    where id = auth.uid() and role = 'owner' and is_active
  )
$$;

-- 有効なオーナーまたは管理者か
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_users
    where id = auth.uid() and is_active
  )
$$;

alter table public.app_users enable row level security;

create policy "app_users: 利用者は読める" on public.app_users
  for select to authenticated using ((select public.is_member()));
create policy "app_users: オーナーが追加" on public.app_users
  for insert to authenticated with check ((select public.is_owner()));
create policy "app_users: オーナーが変更" on public.app_users
  for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

-- -----------------------------------------------------------------------------
-- マスタ（役割・獲得項目・ランク・エリア）。削除せず無効化する
-- -----------------------------------------------------------------------------

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.ranks (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  description text not null default '',
  -- 小さいほど上のランク（候補一覧の並び順に使う）
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.areas (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) > 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array['roles', 'items', 'ranks', 'areas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "%s: 利用者は読める" on public.%I for select to authenticated using ((select public.is_member()))', t, t);
    execute format(
      'create policy "%s: オーナーが追加" on public.%I for insert to authenticated with check ((select public.is_owner()))', t, t);
    execute format(
      'create policy "%s: オーナーが変更" on public.%I for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()))', t, t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- 設定（金額に関係しないもの）。金額・税の設定は owner_settings（★）
-- -----------------------------------------------------------------------------

create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create trigger settings_updated_at before update on public.settings
  for each row execute function public.set_updated_at();

alter table public.settings enable row level security;
create policy "settings: 利用者は読める" on public.settings
  for select to authenticated using ((select public.is_member()));
create policy "settings: オーナーが追加" on public.settings
  for insert to authenticated with check ((select public.is_owner()));
create policy "settings: オーナーが変更" on public.settings
  for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

-- 文面テンプレート
create type public.template_kind as enum (
  'offer',                  -- 打診
  'confirm',                -- 確定連絡
  'reminder',               -- 前日リマインド
  'availability_request',   -- 稼働可能日の提出依頼（全体向け）
  'availability_reminder',  -- 稼働可能日の個別リマインド
  'report_request'          -- 実績報告のお願い
);

create table public.message_templates (
  kind public.template_kind primary key,
  body text not null,
  updated_at timestamptz not null default now()
);

create trigger message_templates_updated_at before update on public.message_templates
  for each row execute function public.set_updated_at();

alter table public.message_templates enable row level security;
create policy "message_templates: 利用者は読める" on public.message_templates
  for select to authenticated using ((select public.is_member()));
create policy "message_templates: オーナーが追加" on public.message_templates
  for insert to authenticated with check ((select public.is_owner()));
create policy "message_templates: オーナーが変更" on public.message_templates
  for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
