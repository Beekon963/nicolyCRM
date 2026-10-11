-- =============================================================================
-- Phase 3-4: 月次締め
--
-- - 締めると、その月の請求（取引先ごと）・支払い（スタッフごと）・月の数字をスナップショットとして保存し、
--   その月の実績・単価・経費・アサイン・現場を変更できなくする（lock_check）。
-- - 金額の計算は src/lib/money だけで行う。ここでは計算済みの値を1回の処理でまとめて保存するだけ。
-- - ロック解除はオーナーだけ、理由を記録する。もう一度締めると、支払済みの状態と支払日は残す。
-- =============================================================================

-- 月の数字（売上・支払・粗利の確定分と見込み分）のスナップショット
alter table public.monthly_closings add column summary jsonb not null default '{}'::jsonb;

-- -----------------------------------------------------------------------------
-- 締めた月の現場も変更できないようにする（中止・日付・取引先・会場の変更で請求が変わるため）
-- -----------------------------------------------------------------------------

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
    if tg_table_name = 'events' then
      d := (j ->> 'date')::date;
    elsif j ? 'assignment_id' then
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

create trigger events_lock before insert or update or delete on public.events
  for each row execute function public.lock_check();

-- -----------------------------------------------------------------------------
-- 締める（初めて／もう一度）
--   p_summary  月の数字
--   p_invoices [{company_id, subtotal, tax, total, detail}]
--   p_payments [{staff_id, daily_total, incentive_total, adjustment_total, expense_total,
--                withholding_base, withholding_amount, net_amount, detail}]
-- 戻り値: {changed_paid: [{staff_id, before, after}]}（支払済みの人で金額が変わった人）
-- -----------------------------------------------------------------------------

create or replace function public.close_month(p_month date, p_summary jsonb, p_invoices jsonb, p_payments jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  m date := public.month_start(p_month);
  prev public.closing_status;
  changed jsonb;
begin
  if not public.is_owner() then
    raise exception '月次締めはオーナーだけができます' using errcode = '42501';
  end if;
  if m >= public.month_start(public.jst_today()) then
    raise exception '%年%月はまだ終わっていないため締められません', extract(year from m), extract(month from m)
      using errcode = 'P0001';
  end if;

  select status into prev from public.monthly_closings where month = m for update;
  if prev = 'closed' then
    raise exception '%年%月はすでに締めています', extract(year from m), extract(month from m)
      using errcode = 'P0001';
  end if;

  -- 支払済みの人で、金額が変わる人（もう一度締めるとき。差額は翌月の調整額で精算する）
  select coalesce(jsonb_agg(jsonb_build_object('staff_id', p.staff_id, 'before', p.net_amount, 'after', coalesce((x.value ->> 'net_amount')::integer, 0))), '[]'::jsonb)
    into changed
    from public.payments p
    left join jsonb_array_elements(p_payments) x on (x.value ->> 'staff_id')::uuid = p.staff_id
   where p.month = m and p.status = 'paid'
     and p.net_amount is distinct from coalesce((x.value ->> 'net_amount')::integer, 0);

  -- 請求: 入れ直す
  delete from public.invoices where month = m;
  insert into public.invoices (company_id, month, subtotal, tax, total, detail, snapshot_at)
  select (x ->> 'company_id')::uuid, m, (x ->> 'subtotal')::integer, (x ->> 'tax')::integer, (x ->> 'total')::integer,
         coalesce(x -> 'detail', '{}'::jsonb), now()
    from jsonb_array_elements(p_invoices) x;

  -- 支払い: 支払済みの状態と支払日は残す。今回いなくなった人は消す（支払済みは残す）
  delete from public.payments p
   where p.month = m and p.status <> 'paid'
     and not exists (select 1 from jsonb_array_elements(p_payments) x where (x ->> 'staff_id')::uuid = p.staff_id);
  insert into public.payments (
    staff_id, month, daily_total, incentive_total, adjustment_total, expense_total,
    withholding_base, withholding_amount, net_amount, status, detail, snapshot_at
  )
  select (x ->> 'staff_id')::uuid, m,
         (x ->> 'daily_total')::integer, (x ->> 'incentive_total')::integer, (x ->> 'adjustment_total')::integer,
         (x ->> 'expense_total')::integer, (x ->> 'withholding_base')::integer, (x ->> 'withholding_amount')::integer,
         (x ->> 'net_amount')::integer, 'confirmed', coalesce(x -> 'detail', '{}'::jsonb), now()
    from jsonb_array_elements(p_payments) x
  on conflict (staff_id, month) do update set
    daily_total = excluded.daily_total,
    incentive_total = excluded.incentive_total,
    adjustment_total = excluded.adjustment_total,
    expense_total = excluded.expense_total,
    withholding_base = excluded.withholding_base,
    withholding_amount = excluded.withholding_amount,
    net_amount = excluded.net_amount,
    status = case when public.payments.status = 'paid' then 'paid'::public.payment_status else 'confirmed'::public.payment_status end,
    detail = excluded.detail,
    snapshot_at = excluded.snapshot_at;

  insert into public.monthly_closings (month, status, closed_at, closed_by, summary)
  values (m, 'closed', now(), auth.uid(), coalesce(p_summary, '{}'::jsonb))
  on conflict (month) do update set
    status = 'closed', closed_at = excluded.closed_at, closed_by = excluded.closed_by, summary = excluded.summary;

  insert into public.closing_logs (month, action, reason)
  values (m, case when prev is null then 'close'::public.closing_action else 'reclose'::public.closing_action end, '');

  return jsonb_build_object('changed_paid', changed);
end;
$$;

-- -----------------------------------------------------------------------------
-- ロック解除（理由は必須）。確定した支払いは「未確定」に戻す（支払済みはそのまま）
-- -----------------------------------------------------------------------------

create or replace function public.unlock_month(p_month date, p_reason text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  m date := public.month_start(p_month);
begin
  if not public.is_owner() then
    raise exception 'ロック解除はオーナーだけができます' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'ロックを解除する理由を入れてください' using errcode = 'P0001';
  end if;
  update public.monthly_closings set status = 'unlocked' where month = m and status = 'closed';
  if not found then
    raise exception '%年%月は締めていません', extract(year from m), extract(month from m) using errcode = 'P0001';
  end if;
  update public.payments set status = 'unconfirmed' where month = m and status = 'confirmed';
  insert into public.closing_logs (month, action, reason) values (m, 'unlock', btrim(p_reason));
end;
$$;

-- -----------------------------------------------------------------------------
-- 支払済みにする／取り消す（p_paid_on が null なら取り消し）。締めた月だけ
-- -----------------------------------------------------------------------------

create or replace function public.set_payments_paid(p_month date, p_staff_ids uuid[], p_paid_on date)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  m date := public.month_start(p_month);
  n integer;
begin
  if not public.is_owner() then
    raise exception '支払いの状態はオーナーだけが変えられます' using errcode = '42501';
  end if;
  if not public.is_month_closed(m) then
    raise exception '%年%月を締めてから、支払済みにしてください', extract(year from m), extract(month from m)
      using errcode = 'P0001';
  end if;
  if p_paid_on is null then
    update public.payments set status = 'confirmed', paid_on = null
     where month = m and staff_id = any (p_staff_ids) and status = 'paid';
  else
    update public.payments set status = 'paid', paid_on = p_paid_on
     where month = m and staff_id = any (p_staff_ids) and status in ('confirmed', 'paid');
  end if;
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.close_month(date, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.unlock_month(date, text) to authenticated;
grant execute on function public.set_payments_paid(date, uuid[], date) to authenticated;
