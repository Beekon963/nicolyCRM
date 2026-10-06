-- =============================================================================
-- 変更履歴（監査ログ）・月次締めのロック・キャンセル時の自動メモ
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 変更履歴（★ オーナーのみ閲覧。実績の履歴だけ report_history() で管理者も見られる）
-- -----------------------------------------------------------------------------

create table public.audit_logs (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  before jsonb,
  after jsonb,
  changed_fields text[],
  user_id uuid,   -- ログインしている利用者（オーナー・管理者）
  staff_id uuid,  -- マイページから変更したスタッフ
  created_at timestamptz not null default now()
);

create index audit_logs_row_idx on public.audit_logs (table_name, row_id);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

alter table public.audit_logs enable row level security;
create policy "audit_logs: オーナーのみ読める" on public.audit_logs
  for select to authenticated using ((select public.is_owner()));

-- トリガー引数に主キーの列名を渡す（複合キーは ':' でつなぐ）
create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_j jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  new_j jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  src jsonb := coalesce(new_j, old_j);
  rid text;
  changed text[];
  ignored text[] := array['updated_at', 'search_text', 'phone_digits', 'name_key'];
begin
  select string_agg(src ->> a.col, ':' order by a.ord)
    into rid
    from unnest(tg_argv) with ordinality as a (col, ord);

  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key)
      into changed
      from jsonb_each(new_j) as n
     where not (n.key = any (ignored))
       and n.value is distinct from (old_j -> n.key);
    if changed is null then
      return null;
    end if;
  end if;

  insert into public.audit_logs (table_name, row_id, action, before, after, changed_fields, user_id, staff_id)
  values (
    tg_table_name, coalesce(rid, ''), lower(tg_op), old_j, new_j, changed,
    auth.uid(),
    nullif(current_setting('app.actor_staff_id', true), '')::uuid
  );
  return null;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('app_users', 'id'),
      ('companies', 'id'),
      ('assignments', 'id'),
      ('reports', 'assignment_id'),
      ('report_items', 'assignment_id,item_id'),
      ('expenses', 'id'),
      ('staff_private', 'staff_id'),
      ('rank_rates', 'rank_id'),
      ('company_billing', 'company_id'),
      ('client_rates', 'id'),
      ('event_rates', 'id'),
      ('incentive_rates', 'item_id'),
      ('event_incentive_rates', 'event_id,item_id'),
      ('assignment_private', 'assignment_id'),
      ('payment_adjustments', 'id'),
      ('monthly_closings', 'month'),
      ('payments', 'id'),
      ('invoices', 'id'),
      ('owner_settings', 'key'),
      ('monthly_targets', 'month')
    ) as t (tbl, pk)
  loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger(%s)',
      r.tbl || '_audit', r.tbl,
      (select string_agg(quote_literal(c), ', ') from unnest(string_to_array(r.pk, ',')) as c)
    );
  end loop;
end;
$$;

-- 実績（速報・確定）の修正履歴。金額を含まないので管理者も見られる（要件 §4.7）
create or replace function public.report_history(p_assignment_id uuid)
returns table (
  table_name text,
  item_id uuid,
  action text,
  before jsonb,
  after jsonb,
  changed_fields text[],
  user_name text,
  by_staff boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    l.table_name,
    case when l.table_name = 'report_items' then (coalesce(l.after, l.before) ->> 'item_id')::uuid end,
    l.action,
    l.before,
    l.after,
    l.changed_fields,
    u.name,
    l.staff_id is not null,
    l.created_at
  from public.audit_logs l
  left join public.app_users u on u.id = l.user_id
  where public.is_member()
    and l.table_name in ('reports', 'report_items')
    and (l.row_id = p_assignment_id::text or l.row_id like p_assignment_id::text || ':%')
  order by l.created_at, l.id
$$;

-- -----------------------------------------------------------------------------
-- 月次締めのロック: 締めた月の実績・単価・経費・調整額・日当上書き・アサインは変更不可
-- -----------------------------------------------------------------------------

create or replace function public.is_month_closed(d date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.monthly_closings
    where month = public.month_start(d) and status = 'closed'
  )
$$;

create or replace function public.lock_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  j jsonb;
  d date;
begin
  foreach j in array array[
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  ] loop
    continue when j is null;
    d := null;
    if j ? 'assignment_id' then
      select e.date into d
        from public.assignments a join public.events e on e.id = a.event_id
       where a.id = (j ->> 'assignment_id')::uuid;
    elsif j ? 'event_id' then
      select e.date into d from public.events e where e.id = (j ->> 'event_id')::uuid;
    elsif j ? 'month' then
      d := (j ->> 'month')::date;
    end if;
    if d is not null and public.is_month_closed(d) then
      raise exception '%年%月は締め済みのため変更できません。変更するにはオーナーがロックを解除してください。',
        extract(year from d), extract(month from d)
        using errcode = 'P0001';
    end if;
  end loop;
  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'assignments', 'reports', 'report_items', 'expenses', 'assignment_private',
    'event_rates', 'event_incentive_rates', 'payment_adjustments'
  ] loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I for each row execute function public.lock_check()',
      t || '_lock', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- キャンセル・当日不稼働にしたら稼働履歴メモに自動で記録する（要件 §4.3）
-- -----------------------------------------------------------------------------

-- 理由コード（画面の選択肢と同じ。src/lib/labels.ts）
--   self   本人都合        no_contact 連絡なし       late  遅刻・遅延
--   trouble トラブル        client    取引先・現場の都合   adjust 人数調整   other その他
create or replace function public.assignments_auto_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev record;
  k public.note_kind;
  label text;
begin
  if new.status not in ('cancelled', 'no_show') or new.status = old.status then
    return null;
  end if;

  select e.date, v.name as venue_name into ev
    from public.events e join public.venues v on v.id = e.venue_id
   where e.id = new.event_id;

  k := case new.cancel_reason_code
    when 'self' then case when ev.date - public.jst_today() <= 3 then 'last_minute_cancel' else 'other' end
    when 'no_contact' then 'last_minute_cancel'
    when 'late' then 'late'
    when 'trouble' then 'trouble'
    else 'other'
  end::public.note_kind;

  label := case new.status when 'cancelled' then 'キャンセル' else '当日不稼働' end;

  insert into public.staff_notes (staff_id, date, kind, memo, is_auto, assignment_id)
  values (
    new.staff_id,
    ev.date,
    k,
    format('%s（%s %s）%s', label, to_char(ev.date, 'FMMM/FMDD'), ev.venue_name,
           case when new.cancel_reason <> '' then ': ' || new.cancel_reason else '' end),
    true,
    new.id
  );
  return null;
end;
$$;

create trigger assignments_auto_note after update of status on public.assignments
  for each row execute function public.assignments_auto_note();
