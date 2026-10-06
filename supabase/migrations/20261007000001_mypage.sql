-- =============================================================================
-- スタッフ用マイページ（ログイン不要）の DB 関数（docs/design/security.md §5）
--
-- - ログインしていない利用者（anon）はテーブルを一切読めない。この関数だけを呼べる。
-- - どの関数も最初に URL の鍵（トークン）を検証してスタッフを特定し、そのスタッフの分だけを扱う。
-- - 金額（日当・インセンティブ・支払額）は返さない。交通費・経費は本人が申請した額だけ。
-- - 変更履歴には「マイページから変更したスタッフ」として記録される（app.actor_staff_id）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- レート制限
-- -----------------------------------------------------------------------------

create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);

-- 誰も直接は読み書きできない（関数だけが使う）
alter table public.rate_limits enable row level security;

-- 1分あたりの回数を数え、上限以内なら true。
-- 例外にすると数えた分も取り消されてしまうので、例外は使わない
create or replace function public.rate_limit_hit(p_key text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  w timestamptz := date_trunc('minute', now());
  c integer;
begin
  insert into public.rate_limits (key, window_start, count)
  values (p_key, w, 1)
  on conflict (key, window_start) do update set count = public.rate_limits.count + 1
  returning count into c;
  -- 古い記録はときどき消す
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 hour';
  end if;
  return c <= p_limit;
end;
$$;

-- -----------------------------------------------------------------------------
-- 鍵の検証（内部用。anon には公開しない）
-- -----------------------------------------------------------------------------

-- 鍵を検証してスタッフを返す。使えない鍵・回数オーバーのときは id が null の行と error を返す
create or replace function public.mypage_staff(p_token text, out staff public.staff, out error text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token is not null and length(p_token) >= 40 then
    select * into staff from public.staff s where s.mypage_token = p_token and s.status <> 'ended';
  end if;
  if staff.id is null then
    -- 鍵の総当たり対策（全体で1分300回まで。上限を超えたら正しい鍵でも少し待ってもらう）
    perform public.rate_limit_hit('mypage:invalid', 300);
    error := 'invalid_token';
    return;
  end if;
  -- 1人あたり1分120回まで
  if not public.rate_limit_hit('mypage:' || staff.id::text, 120) then
    error := 'rate_limited';
    staff := null;
    return;
  end if;
  -- 変更履歴に「スタッフ本人の操作」として残す
  perform set_config('app.actor_staff_id', staff.id::text, true);
end;
$$;

create or replace function public.setting_int(p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (value #>> '{}')::integer from public.settings where key = p_key), p_default)
$$;

-- 現場の表示用（金額なし）
create or replace function public.mypage_event_json(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id,
    'date', e.date,
    'start_time', e.start_time,
    'end_time', e.end_time,
    'meeting_time', e.meeting_time,
    'meeting_place', e.meeting_place,
    'belongings', e.belongings,
    'notes', e.notes,
    'cancelled', e.cancelled_at is not null,
    'venue', jsonb_build_object(
      'name', v.name, 'address', v.address, 'nearest_station', v.nearest_station,
      'access_notes', v.access_notes, 'green_room', v.green_room, 'parking', v.parking
    )
  )
  from public.events e join public.venues v on v.id = e.venue_id
  where e.id = p_event_id
$$;

-- -----------------------------------------------------------------------------
-- マイページ（anon に公開）
-- どの関数も jsonb を返す。想定内のエラーは {"error": "..."} で返す（例外にしない）:
--   invalid_token 鍵が使えない / rate_limited 回数オーバー / not_found 対象がない /
--   closed 中止・過去の現場 / already_confirmed 管理者が確定済み / out_of_window 報告期限外 / out_of_range 対象外の月
-- -----------------------------------------------------------------------------

-- 名前と、タブに出す件数
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
       where a.staff_id = s.id and a.status = 'confirmed' and e.cancelled_at is null
         and e.date <= public.jst_today() and e.date >= public.jst_today() - win
         and r.submitted_at is null
    )
  );
end;
$$;

-- お願い（打診中）
create or replace function public.mypage_offers(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ms record;
  s public.staff;
  err text;
begin
  select * into ms from public.mypage_staff(p_token);
  s := ms.staff;
  err := ms.error;
  if err is not null then return jsonb_build_object('error', err); end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(
      jsonb_build_object('assignment_id', a.id, 'role', ro.name, 'offered_at', a.offered_at, 'event', public.mypage_event_json(a.event_id))
      order by e.date, e.start_time
    )
    from public.assignments a
    join public.events e on e.id = a.event_id
    join public.roles ro on ro.id = a.role_id
    where a.staff_id = s.id and a.status = 'offered' and e.date >= public.jst_today() and e.cancelled_at is null
  ), '[]'::jsonb));
end;
$$;

-- 「参加できる / できない」。参加できるなら空きを確認して確定 or 補欠（同時に押されても定員を超えない）
create or replace function public.mypage_respond(p_token text, p_assignment_id uuid, p_accept boolean)
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
  required integer;
  confirmed integer;
  next_status public.assignment_status;
begin
  select * into ms from public.mypage_staff(p_token);
  s := ms.staff;
  err := ms.error;
  if err is not null then return jsonb_build_object('error', err); end if;

  select * into a from public.assignments where id = p_assignment_id and staff_id = s.id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if a.status <> 'offered' then
    -- すでに回答済み（変更は管理者に連絡）
    return jsonb_build_object('status', a.status, 'already', true);
  end if;
  select * into ev from public.events where id = a.event_id;
  if ev.cancelled_at is not null or ev.date < public.jst_today() then
    return jsonb_build_object('error', 'closed');
  end if;

  if p_accept then
    -- 同じ役割の枠を順番に処理する（行ロック）
    select r.required_count into required
      from public.event_requirements r
     where r.event_id = a.event_id and r.role_id = a.role_id
       for update;
    select count(*) into confirmed
      from public.assignments x
     where x.event_id = a.event_id and x.role_id = a.role_id and x.status = 'confirmed';
    next_status := case when confirmed < coalesce(required, 0) then 'confirmed' else 'waitlisted' end;
  else
    next_status := 'declined';
  end if;

  update public.assignments
     set status = next_status, responded_at = now(), response_source = 'self'
   where id = a.id;
  return jsonb_build_object('status', next_status);
end;
$$;

-- 予定（確定・補欠の現場。今日以降）
create or replace function public.mypage_schedule(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ms record;
  s public.staff;
  err text;
begin
  select * into ms from public.mypage_staff(p_token);
  s := ms.staff;
  err := ms.error;
  if err is not null then return jsonb_build_object('error', err); end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(
      jsonb_build_object('assignment_id', a.id, 'role', ro.name, 'status', a.status, 'event', public.mypage_event_json(a.event_id))
      order by e.date, e.start_time
    )
    from public.assignments a
    join public.events e on e.id = a.event_id
    join public.roles ro on ro.id = a.role_id
    where a.staff_id = s.id and a.status in ('confirmed', 'waitlisted') and e.date >= public.jst_today()
  ), '[]'::jsonb));
end;
$$;

-- 報告できる稼働（稼働日〜期限）
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
      where a.staff_id = s.id and a.status = 'confirmed' and e.cancelled_at is null
        and e.date <= public.jst_today() and e.date >= public.jst_today() - win
    ), '[]'::jsonb)
  );
end;
$$;

-- 実績報告の表示（獲得項目は、その現場の取引先で使う項目。決定3）
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
    ), '{}'::jsonb)
  );
end;
$$;

-- 実績報告の保存（稼働日〜期限、管理者が確定する前だけ）
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

  -- 交通費・その他の経費（承認・却下されたものは本人は変更できない）
  foreach k in array array['transport', 'other']::public.expense_kind[] loop
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

-- 稼働可能日の表示（今月・翌月）
create or replace function public.mypage_availability_get(p_token text, p_month date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ms record;
  s public.staff;
  err text;
  m date := public.month_start(p_month);
  this_month date := public.month_start(public.jst_today());
  sub public.availability_submissions;
  deadline_day integer := public.setting_int('availability_deadline_day', 20);
begin
  select * into ms from public.mypage_staff(p_token);
  s := ms.staff;
  err := ms.error;
  if err is not null then return jsonb_build_object('error', err); end if;
  if m not in (this_month, (this_month + interval '1 month')::date) then
    return jsonb_build_object('error', 'out_of_range');
  end if;
  select * into sub from public.availability_submissions where staff_id = s.id and month = m;
  return jsonb_build_object(
    'month', m,
    'today', public.jst_today(),
    -- 締切: 翌月分は前月の締切日（例: 11月分は 10/20）
    'deadline', ((m - interval '1 month')::date + (deadline_day - 1)),
    'memo', coalesce(sub.memo, ''),
    'submitted_at', sub.submitted_at,
    'days', coalesce((
      select jsonb_object_agg(av.date, av.status)
      from public.availability av
      where av.staff_id = s.id and av.date >= m and av.date < (m + interval '1 month')::date
    ), '{}'::jsonb),
    -- 確定している現場（カレンダーに印を出す）
    'events', coalesce((
      select jsonb_object_agg(e.date, v.name)
      from public.assignments a join public.events e on e.id = a.event_id join public.venues v on v.id = e.venue_id
      where a.staff_id = s.id and a.status = 'confirmed' and e.cancelled_at is null
        and e.date >= m and e.date < (m + interval '1 month')::date
    ), '{}'::jsonb)
  );
end;
$$;

-- 稼働可能日の保存・提出（今日より前の日は変えない）
create or replace function public.mypage_availability_save(p_token text, p_month date, p_days jsonb, p_memo text, p_submit boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ms record;
  s public.staff;
  err text;
  m date := public.month_start(p_month);
  this_month date := public.month_start(public.jst_today());
  d record;
  dt date;
begin
  select * into ms from public.mypage_staff(p_token);
  s := ms.staff;
  err := ms.error;
  if err is not null then return jsonb_build_object('error', err); end if;
  if m not in (this_month, (this_month + interval '1 month')::date) then
    return jsonb_build_object('error', 'out_of_range');
  end if;
  for d in select key, value from jsonb_each(coalesce(p_days, '{}'::jsonb)) loop
    dt := d.key::date;
    continue when dt < public.jst_today() or dt < m or dt >= (m + interval '1 month')::date;
    if jsonb_typeof(d.value) = 'null' then
      delete from public.availability where staff_id = s.id and date = dt;
    else
      insert into public.availability (staff_id, date, status, source, updated_by, updated_at)
      values (s.id, dt, (d.value #>> '{}')::public.availability_status, 'self', null, now())
      on conflict (staff_id, date) do update
        set status = excluded.status, source = 'self', updated_by = null, updated_at = now();
    end if;
  end loop;

  insert into public.availability_submissions (staff_id, month, memo, submitted_at, source)
  values (s.id, m, left(coalesce(p_memo, ''), 300), case when p_submit then now() end, 'self')
  on conflict (staff_id, month) do update
    set memo = excluded.memo,
        submitted_at = case when p_submit then now() else public.availability_submissions.submitted_at end,
        source = case when p_submit then 'self'::public.input_source else public.availability_submissions.source end;
  return jsonb_build_object('ok', true);
end;
$$;

-- 過去の稼働（直近6か月。自分の獲得件数の確定 / 速報）
create or replace function public.mypage_history(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ms record;
  s public.staff;
  err text;
begin
  select * into ms from public.mypage_staff(p_token);
  s := ms.staff;
  err := ms.error;
  if err is not null then return jsonb_build_object('error', err); end if;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(row_to_json(t)::jsonb order by t.date desc)
    from (
      select e.date, v.name as venue, ro.name as role, a.status,
             (select sum(ri.reported_count) from public.report_items ri where ri.assignment_id = a.id) as reported,
             case when r.confirmed_at is not null
                  then (select coalesce(sum(ri.confirmed_count), 0) from public.report_items ri where ri.assignment_id = a.id) end as confirmed
      from public.assignments a
      join public.events e on e.id = a.event_id
      join public.venues v on v.id = e.venue_id
      join public.roles ro on ro.id = a.role_id
      left join public.reports r on r.assignment_id = a.id
      where a.staff_id = s.id and a.status in ('confirmed', 'no_show') and e.cancelled_at is null
        and e.date < public.jst_today() and e.date >= (public.jst_today() - interval '6 months')::date
    ) t
  ), '[]'::jsonb));
end;
$$;

-- -----------------------------------------------------------------------------
-- 公開範囲: マイページ用の関数だけを anon に許可する
-- -----------------------------------------------------------------------------

revoke execute on function public.rate_limit_hit(text, integer) from public, anon, authenticated;
revoke execute on function public.mypage_staff(text) from public, anon, authenticated;
revoke execute on function public.mypage_event_json(uuid) from public, anon, authenticated;
revoke execute on function public.setting_int(text, integer) from public, anon;

grant execute on function public.mypage_me(text) to anon, authenticated;
grant execute on function public.mypage_offers(text) to anon, authenticated;
grant execute on function public.mypage_respond(text, uuid, boolean) to anon, authenticated;
grant execute on function public.mypage_schedule(text) to anon, authenticated;
grant execute on function public.mypage_reports(text) to anon, authenticated;
grant execute on function public.mypage_report_get(text, uuid) to anon, authenticated;
grant execute on function public.mypage_report_save(text, uuid, jsonb, text, integer, text, integer, text) to anon, authenticated;
grant execute on function public.mypage_availability_get(text, date) to anon, authenticated;
grant execute on function public.mypage_availability_save(text, date, jsonb, text, boolean) to anon, authenticated;
grant execute on function public.mypage_history(text) to anon, authenticated;
