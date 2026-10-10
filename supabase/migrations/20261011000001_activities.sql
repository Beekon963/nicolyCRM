-- =============================================================================
-- Phase 2: 活動の記録（要件 §4.8「活動の記録はスマホで10秒」）
--
-- 記録すると、活動履歴に1行足し、会社の「次回アクション日・次にやること」（とステータス）を
-- 同時に書き換える。直後なら「元に戻す」で記録を消し、会社の値も記録前に戻せる。
-- =============================================================================

-- この記録で変えたステータス（変えなかったときは空）。活動履歴に「→ 商談設定」と出す
alter table public.activities add column status public.company_status;

-- 「元に戻す」のためだけに、記録した本人が直後（15分以内）に限って消せる。それ以外は履歴として残す
create policy "activities: 記録した本人が直後だけ削除" on public.activities
  for delete to authenticated
  using ((select public.is_member()) and user_id = (select auth.uid()) and created_at > now() - interval '15 minutes');

-- 活動を記録し、会社の次回アクション（とステータス）を書き換える。
-- 呼んだ人の権限（RLS）のまま動く。戻り値の before は「元に戻す」で使う記録前の値
create or replace function public.record_activity(
  p_company_id uuid,
  p_kind public.activity_kind,
  p_result public.activity_result,
  p_memo text,
  p_contact_id uuid,
  p_next_action_date date,
  p_next_action text,
  p_status public.company_status
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_before record;
  v_id uuid;
  v_status public.company_status;
begin
  select c.status, c.next_action_date, c.next_action into v_before
    from public.companies c where c.id = p_company_id for update;
  if not found then
    raise exception '会社が見つかりません' using errcode = 'P0002';
  end if;
  if p_contact_id is not null
     and not exists (select 1 from public.contacts ct where ct.id = p_contact_id and ct.company_id = p_company_id) then
    raise exception 'この会社の担当者ではありません' using errcode = 'P0001';
  end if;

  v_status := case when p_status is distinct from v_before.status then p_status end;

  insert into public.activities (company_id, contact_id, kind, result, memo, next_action_date, next_action, status)
  values (p_company_id, p_contact_id, p_kind, p_result, coalesce(trim(p_memo), ''), p_next_action_date,
          coalesce(trim(p_next_action), ''), v_status)
  returning id into v_id;

  update public.companies
     set next_action_date = p_next_action_date,
         next_action = coalesce(trim(p_next_action), ''),
         status = coalesce(v_status, status)
   where id = p_company_id;

  return jsonb_build_object(
    'id', v_id,
    'before', jsonb_build_object(
      'status', v_before.status,
      'next_action_date', v_before.next_action_date,
      'next_action', v_before.next_action
    )
  );
end;
$$;

-- 記録の取り消し（「元に戻す」）。記録した本人が15分以内に限る（削除の RLS で確かめる）。
-- 会社の値は、記録で書き換えたままのときだけ記録前に戻す（その後だれかが直していたら上書きしない）
create or replace function public.undo_activity(p_activity_id uuid, p_before jsonb)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  a public.activities;
begin
  delete from public.activities where id = p_activity_id returning * into a;
  if not found then
    return false;
  end if;
  update public.companies c
     set next_action_date = (p_before ->> 'next_action_date')::date,
         next_action = coalesce(p_before ->> 'next_action', ''),
         status = coalesce(case when a.status is not null then (p_before ->> 'status')::public.company_status end, c.status)
   where c.id = a.company_id
     and c.next_action_date is not distinct from a.next_action_date
     and c.next_action = a.next_action
     and (a.status is null or c.status = a.status);
  return true;
end;
$$;
