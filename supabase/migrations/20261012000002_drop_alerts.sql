-- =============================================================================
-- Phase 6: キャンセル・当日不稼働のお知らせ
--
-- 確定していた人がキャンセル・当日不稼働になったら（今日以降の現場だけ）、オーナー・管理者に知らせる。
-- - 画面: assignment_alerts を CRM の画面が1分ごとに見て、まだ見ていないものをポップアップで出す
--   （操作した本人には出さない。「確認した」を押すと alert_seen に見た時刻を残し、次から出さない）
-- - LINE: line_outbox に admin_cancel を入れる（社内向け。公式アカウントの設定ができてから届く）
-- 金額は扱わない。
-- =============================================================================

create table public.assignment_alerts (
  id uuid primary key default gen_random_uuid(),
  -- アサインが消えたら（現場を消したときなど）お知らせも消える
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  status public.assignment_status not null check (status in ('cancelled', 'no_show')),
  -- 操作した人（その人には出さない）
  actor_user_id uuid references public.app_users (id),
  created_at timestamptz not null default now()
);

create index assignment_alerts_created_idx on public.assignment_alerts (created_at desc);

alter table public.assignment_alerts enable row level security;
-- メンバーは読める。入れるのはトリガーだけ
create policy "assignment_alerts: メンバーは読める" on public.assignment_alerts
  for select to authenticated using ((select public.is_member()));

-- お知らせをどこまで見たか（1人1行。自分の行だけ読み書きできる）
create table public.alert_seen (
  user_id uuid primary key default auth.uid() references public.app_users (id) on delete cascade,
  seen_at timestamptz not null default now()
);

alter table public.alert_seen enable row level security;
create policy "alert_seen: 自分の分は読める" on public.alert_seen
  for select to authenticated using (user_id = (select auth.uid()));
create policy "alert_seen: 自分の分を入れられる" on public.alert_seen
  for insert to authenticated with check (user_id = (select auth.uid()) and (select public.is_member()));
create policy "alert_seen: 自分の分を直せる" on public.alert_seen
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 確定 → キャンセル・当日不稼働 になったら、お知らせを入れる（今日以降の、中止でない現場だけ）
create or replace function public.assignments_drop_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'confirmed' and new.status in ('cancelled', 'no_show')
     and exists (select 1 from public.events e where e.id = new.event_id and e.cancelled_at is null and e.date >= public.jst_today()) then
    insert into public.assignment_alerts (assignment_id, status, actor_user_id)
    values (new.id, new.status, (select u.id from public.app_users u where u.id = auth.uid()));
  end if;
  return new;
end;
$$;

create trigger assignments_drop_alert
  after update of status on public.assignments
  for each row execute function public.assignments_drop_alert();

revoke execute on function public.assignments_drop_alert() from public, anon, authenticated;

-- LINE: 社内に「キャンセル・当日不稼働が出ました」を送る種類を足す
alter table public.line_outbox drop constraint line_outbox_kind_check;
alter table public.line_outbox
  add constraint line_outbox_kind_check check (kind in ('confirm', 'reminder', 'admin_confirm', 'admin_events', 'admin_cancel'));
alter table public.line_outbox drop constraint line_outbox_check;
alter table public.line_outbox
  add constraint line_outbox_check check ((kind in ('confirm', 'reminder', 'admin_confirm', 'admin_cancel')) = (assignment_id is not null));
