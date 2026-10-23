-- =============================================================================
-- Phase 19: CRM で入れたものをシートにも書く（書き戻し）
--
-- 予定（確定・辞退・取り消し）・現場（作る・直す・中止・消す）・必要人数・○△× が変わったら、
-- 「書き直すマス」（だれの何日 / どの取引先の何日）を待ち行列 sheet_writes に入れる（トリガー）。
-- 2分ごとの定期実行（/api/cron/sheet-writeback。秘密キー）が CRM の今の状態を読み直し、
-- いつものシートの今月・来月のタブの同じマス（場所・シフト・現場・人数）と比べて、違うときだけ書く。
-- シートから読んだ分（Phase 18 の自動の読み取り）も印が付くが、シートと同じなので何も書かない。
-- 単価の行は書かない（金額はシートに出さない）。
-- =============================================================================

create table public.sheet_writes (
  id bigint generated always as identity primary key,
  -- staff_day: その人のその日の「場所」 / availability: その人のその日の「シフト」 / client_day: その取引先のその日の「現場」「人数」
  kind text not null check (kind in ('staff_day', 'availability', 'client_day')),
  -- staff_day / availability: スタッフの id、client_day: 取引先の id
  ref_id uuid not null,
  date date not null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'done', 'skipped', 'failed')),
  message text not null default ''
);
create index sheet_writes_pending_idx on public.sheet_writes (created_at) where status = 'pending';
create index sheet_writes_recent_idx on public.sheet_writes (processed_at desc) where status <> 'pending';

alter table public.sheet_writes enable row level security;
-- メンバーは読める。入れるのはトリガー、直すのはサーバー（秘密キー）だけ
create policy sheet_writes_select on public.sheet_writes
  for select to authenticated using (public.is_member());

-- 印を付ける（同じマスの未処理があれば足さない）
create or replace function public.sheet_write_mark(p_kind text, p_ref uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ref is null or p_date is null then
    return;
  end if;
  if exists (select 1 from public.sheet_writes w where w.status = 'pending' and w.kind = p_kind and w.ref_id = p_ref and w.date = p_date) then
    return;
  end if;
  insert into public.sheet_writes (kind, ref_id, date) values (p_kind, p_ref, p_date);
end;
$$;
revoke execute on function public.sheet_write_mark(text, uuid, date) from public, anon, authenticated;

-- 予定が変わったら、その人のその日（前の現場の日と新しい現場の日）
create or replace function public.assignments_sheet_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d date;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select e.date into d from public.events e where e.id = old.event_id;
    perform public.sheet_write_mark('staff_day', old.staff_id, d);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select e.date into d from public.events e where e.id = new.event_id;
    perform public.sheet_write_mark('staff_day', new.staff_id, d);
  end if;
  return coalesce(new, old);
end;
$$;
revoke execute on function public.assignments_sheet_write() from public, anon, authenticated;

create trigger assignments_sheet_write
  after insert or delete or update of status, event_id, staff_id on public.assignments
  for each row execute function public.assignments_sheet_write();

-- 現場が変わったら、その取引先のその日（前と後）。日付・会場・中止が変わったら、入っている人の日も
create or replace function public.events_sheet_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.sheet_write_mark('client_day', old.client_id, old.date);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.sheet_write_mark('client_day', new.client_id, new.date);
  end if;
  if tg_op = 'UPDATE' and (new.date <> old.date or new.venue_id <> old.venue_id or (new.cancelled_at is null) <> (old.cancelled_at is null)) then
    perform public.sheet_write_mark('staff_day', a.staff_id, old.date) from public.assignments a where a.event_id = new.id;
    perform public.sheet_write_mark('staff_day', a.staff_id, new.date) from public.assignments a where a.event_id = new.id;
  end if;
  return coalesce(new, old);
end;
$$;
revoke execute on function public.events_sheet_write() from public, anon, authenticated;

create trigger events_sheet_write
  after insert or delete or update of date, client_id, venue_id, cancelled_at on public.events
  for each row execute function public.events_sheet_write();

-- 必要人数が変わったら、その取引先のその日
create or replace function public.event_requirements_sheet_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  e record;
begin
  select client_id, date into e from public.events where id = coalesce(new.event_id, old.event_id);
  if found then
    perform public.sheet_write_mark('client_day', e.client_id, e.date);
  end if;
  return coalesce(new, old);
end;
$$;
revoke execute on function public.event_requirements_sheet_write() from public, anon, authenticated;

create trigger event_requirements_sheet_write
  after insert or delete or update on public.event_requirements
  for each row execute function public.event_requirements_sheet_write();

-- ○△× が変わったら、その人のその日
create or replace function public.availability_sheet_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.sheet_write_mark('availability', old.staff_id, old.date);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.sheet_write_mark('availability', new.staff_id, new.date);
  end if;
  return coalesce(new, old);
end;
$$;
revoke execute on function public.availability_sheet_write() from public, anon, authenticated;

create trigger availability_sheet_write
  after insert or delete or update of status, date, staff_id on public.availability
  for each row execute function public.availability_sheet_write();
