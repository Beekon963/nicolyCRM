-- =============================================================================
-- Phase 12: ランク制度に合わせる（2026-10-12 の「ランク制度のご案内」）
--
-- - 日当はランクで決まる（現場ごとの日当 → 人ごとの日当 → ランクの基準日当。計算は src/lib/money）。
--   テーブルは変えない（staff_private.base_daily_rate は「人ごとの日当」として、決まった額と違う人だけ入れる）
-- - ランク「P（パートナー）」を足す（基準日当はなし。日当は人ごと）
-- - 遠方の上乗せ: アサインに「最寄り駅から1時間30分を超える30分の回数」（travel_steps）。
--   回数は金額ではないので管理者も選べる。1回分の額はオーナーだけの設定（owner_settings の travel_allowance）
-- - 友達紹介: スタッフに「紹介してくれた人」（referred_by）。ボーナスは調整額（payment_adjustments）として足し、
--   どの紹介の分かを referral_bonuses（オーナーのみ）に残す。調整額を消せば一緒に消える（もう一度足せる）
-- - 日当は交通費込み（settings の transport_included。初期値オン）: マイページの報告で交通費を受け取らない
-- - 稼働可能日の提出締切: 20日のままなら 10日にする
--
-- 金額（ランクの基準日当・遠方の1回分・紹介のボーナス）はここに入れない。オーナーが設定画面で入力する
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 設定を読む（true / false）
-- -----------------------------------------------------------------------------
create or replace function public.setting_bool(p_key text, p_default boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (value #>> '{}')::boolean from public.settings where key = p_key), p_default)
$$;

-- -----------------------------------------------------------------------------
-- ランク P（パートナー）
-- -----------------------------------------------------------------------------
insert into public.ranks (name, description, sort_order)
select 'P', 'パートナー', coalesce(max(sort_order), 0) + 1 from public.ranks
on conflict (name) do update set description = case when public.ranks.description = '' then 'パートナー' else public.ranks.description end;

-- -----------------------------------------------------------------------------
-- 遠方の上乗せ（1時間30分を超える30分の回数）
-- -----------------------------------------------------------------------------
alter table public.assignments
  add column travel_steps smallint not null default 0 check (travel_steps between 0 and 10);

comment on column public.assignments.travel_steps is
  '最寄り駅から現場まで1時間30分を超える30分の回数（0 = なし）。日当に「回数 × 1回分の額（オーナーの設定）」を足す';

-- -----------------------------------------------------------------------------
-- 友達紹介
-- -----------------------------------------------------------------------------
alter table public.staff
  add column referred_by uuid references public.staff (id) check (referred_by is distinct from id);

comment on column public.staff.referred_by is '紹介してくれたスタッフ（友達紹介のボーナスに使う）';

create table public.referral_bonuses (
  -- 紹介された人（ボーナスは1人につき1回）
  referred_staff_id uuid primary key references public.staff (id),
  referrer_staff_id uuid not null references public.staff (id),
  adjustment_id uuid not null unique references public.payment_adjustments (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.referral_bonuses enable row level security;
create policy "referral_bonuses: オーナーのみ" on public.referral_bonuses
  for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));

create trigger referral_bonuses_audit after insert or update or delete on public.referral_bonuses
  for each row execute function public.audit_trigger('referred_staff_id');

-- -----------------------------------------------------------------------------
-- 日当は交通費込み・稼働可能日の締切
-- -----------------------------------------------------------------------------
insert into public.settings (key, value) values ('transport_included', 'true')
on conflict (key) do nothing;

update public.settings set value = '10' where key = 'availability_deadline_day' and value = '20'::jsonb;

-- -----------------------------------------------------------------------------
-- マイページの報告: 交通費込みかどうかを返す（ほかは 20261012000004 と同じ）
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
    -- 日当は交通費込み（交通費の欄を出さない。Phase 12）
    'transport_included', public.setting_bool('transport_included', false),
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

-- -----------------------------------------------------------------------------
-- マイページの報告の保存: 交通費込みのあいだは交通費を受け取らない（ほかは 20261007000001 と同じ）
-- -----------------------------------------------------------------------------

create or replace function public.mypage_report_save(
  p_token text,
  p_assignment_id uuid,
  p_items jsonb,          -- [{ "item_id": "...", "count": 3 }, ...]
  p_comment text,
  p_transport_amount integer,
  p_transport_memo text,
  p_other_amount integer,
  p_other_memo text
)
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
  it jsonb;
  cnt integer;
  k public.expense_kind;
  amt integer;
  memo text;
  cur public.expenses;
begin
  select * into ms from public.mypage_staff(p_token);
  s := ms.staff;
  err := ms.error;
  if err is not null then return jsonb_build_object('error', err); end if;
  select * into a from public.assignments where id = p_assignment_id and staff_id = s.id for update;
  if not found or a.status <> 'confirmed' then return jsonb_build_object('error', 'not_found'); end if;
  select * into ev from public.events where id = a.event_id;
  select * into r from public.reports where assignment_id = a.id;
  if r.confirmed_at is not null then return jsonb_build_object('error', 'already_confirmed'); end if;
  if ev.cancelled_at is not null or ev.date > public.jst_today() or public.jst_today() > ev.date + win then
    return jsonb_build_object('error', 'out_of_window');
  end if;

  insert into public.reports (assignment_id, comment, submitted_at, source)
  values (a.id, left(coalesce(p_comment, ''), 500), now(), 'self')
  on conflict (assignment_id) do update
    set comment = excluded.comment, submitted_at = excluded.submitted_at, source = 'self';

  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    cnt := greatest(0, least(999, coalesce((it ->> 'count')::integer, 0)));
    insert into public.report_items (assignment_id, item_id, reported_count)
    values (a.id, (it ->> 'item_id')::uuid, cnt)
    on conflict (assignment_id, item_id) do update set reported_count = excluded.reported_count;
  end loop;

  -- 交通費・その他の経費（承認・却下されたものは本人は変更できない）。
  -- 日当が交通費込みのあいだは、交通費は受け取らない（今ある分もそのまま。Phase 12）
  foreach k in array array['transport', 'other']::public.expense_kind[] loop
    continue when k = 'transport' and public.setting_bool('transport_included', false);
    amt := case k when 'transport' then p_transport_amount else p_other_amount end;
    memo := left(coalesce(case k when 'transport' then p_transport_memo else p_other_memo end, ''), 200);
    select * into cur from public.expenses where assignment_id = a.id and kind = k;
    if found and cur.status <> 'pending' then
      continue;
    end if;
    if coalesce(amt, 0) <= 0 then
      delete from public.expenses where assignment_id = a.id and kind = k and status = 'pending';
    else
      insert into public.expenses (assignment_id, staff_id, kind, amount, memo, status, source)
      values (a.id, s.id, k, least(amt, 1000000), memo, 'pending', 'self')
      on conflict (assignment_id, kind) do update set amount = excluded.amount, memo = excluded.memo;
    end if;
  end loop;
  return jsonb_build_object('ok', true);
end;
$$;
