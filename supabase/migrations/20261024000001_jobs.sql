-- Phase 21: 案件の進み具合を一か所で（スキルシート → 面談 → 合否 → 現場詳細）
--
-- - 案件 = 取引先からの1通の文（日付・会場・人数の一覧）。今ある「まとめて作った現場のまとまり」event_groups を案件として育てる
-- - 単価は案件に1つ。オーナーだけが読める event_group_private に分ける（管理者が読めるテーブルに金額を足さない）
-- - 案件 × スタッフ の段階（候補 → 本人OK → スキルシート提出 → 候補日あり → 候補日送付済 → 面談日時共有 → 面談済 → 合格／不合格 → 現場詳細展開）
--   は group_candidates。段階の変更は変更履歴（audit_logs）に残す

-- 1. 案件の列
alter table public.event_groups
  add column if not exists client_id uuid references public.companies (id),
  add column if not exists received_on date,
  add column if not exists start_time time,
  add column if not exists end_time time,
  add column if not exists hours_note text not null default '',   -- 「10:00〜18:00 or 11:00〜19:00」のように文のまま
  add column if not exists notes text not null default '',        -- 備考（募集の条件など）
  add column if not exists contact_name text not null default '', -- 取引先の担当者
  add column if not exists source_text text not null default '',  -- 貼った文（見返す用）
  add column if not exists closed_at timestamptz,                 -- 終わった案件
  add column if not exists updated_at timestamptz not null default now();

create index if not exists event_groups_client_idx on public.event_groups (client_id);
create index if not exists event_groups_open_idx on public.event_groups (closed_at) where closed_at is null;

drop trigger if exists event_groups_updated_at on public.event_groups;
create trigger event_groups_updated_at before update on public.event_groups
  for each row execute function public.set_updated_at();

-- 案件の取引先は「取引先」の会社だけ
create or replace function public.check_event_group_client()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.client_id is not null and not exists (select 1 from public.companies c where c.id = new.client_id and c.kind = 'client') then
    raise exception '案件の取引先には「取引先」の会社を選んでください';
  end if;
  return new;
end;
$$;
drop trigger if exists event_groups_client_check on public.event_groups;
create trigger event_groups_client_check before insert or update of client_id on public.event_groups
  for each row execute function public.check_event_group_client();

-- 2. 単価（★ オーナーのみ）
create table public.event_group_private (
  group_id uuid primary key references public.event_groups (id) on delete cascade,
  rate integer check (rate is null or (rate >= 0 and rate <= 10000000)),  -- 請求の人日単価（円）
  transport_included boolean not null default false,                      -- 交通費込
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger event_group_private_updated_at before update on public.event_group_private
  for each row execute function public.set_updated_at();
alter table public.event_group_private enable row level security;
create policy event_group_private_owner on public.event_group_private
  for all to authenticated using (public.is_owner()) with check (public.is_owner());
create trigger event_group_private_audit after insert or update or delete on public.event_group_private
  for each row execute function public.audit_trigger('group_id');

-- 3. 案件 × スタッフ の段階
create type public.candidate_stage as enum (
  'candidate',        -- 候補（これから本人に確認）
  'staff_ok',         -- 本人OK（スキルシートを出す）
  'sheet_sent',       -- スキルシート提出済（本人に面談の候補日時を聞く）
  'slots_collected',  -- 候補日あり（取引先にまとめて送る）
  'slots_sent',       -- 候補日送付済（取引先から面談の日時を待つ）
  'interview_set',    -- 面談日時共有済（面談を待つ）
  'interviewed',      -- 面談済（合否を待つ）
  'passed',           -- 合格（現場詳細をもらって展開する）
  'briefed',          -- 現場詳細展開済（完了）
  'failed',           -- 不合格（別の案件を探す）
  'withdrawn'         -- 辞退・取り下げ
);

create table public.group_candidates (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.event_groups (id) on delete cascade,
  staff_id uuid not null references public.staff (id),
  stage public.candidate_stage not null default 'candidate',
  stage_changed_at timestamptz not null default now(),
  interview_slots text not null default '',  -- 本人からの候補日時（文のまま。改行区切り）
  interview_at timestamptz,                  -- 決まった面談の日時
  interview_note text not null default '',   -- 面談のリンク・場所など
  result_note text not null default '',      -- 合否の連絡のメモ
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, staff_id)
);
create index group_candidates_staff_idx on public.group_candidates (staff_id);
create index group_candidates_stage_idx on public.group_candidates (stage);

create or replace function public.group_candidates_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- now() は同じトランザクションの中では同じ時刻なので、実際の時刻（clock_timestamp）を使う
  if new.stage is distinct from old.stage then
    new.stage_changed_at := clock_timestamp();
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger group_candidates_before_update before update on public.group_candidates
  for each row execute function public.group_candidates_before_update();

alter table public.group_candidates enable row level security;
create policy group_candidates_select on public.group_candidates
  for select to authenticated using (public.is_member());
create policy group_candidates_write on public.group_candidates
  for all to authenticated using (public.is_member()) with check (public.is_member());
create trigger group_candidates_audit after insert or update or delete on public.group_candidates
  for each row execute function public.audit_trigger('id');
