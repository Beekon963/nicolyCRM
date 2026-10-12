-- =============================================================================
-- Phase 8: NextWave の報告フォーマットと自動変換
--
-- 1) 言いかえ表（item_aliases）: LINE に書いた報告のいつもの書き方（例: キヘン・光・GOLD）を、
--    取引先の獲得項目の名前（公認名称。例: 機種変更・ドコモ光 1G・ｄカードGOLD）に直すための表。
--    取引先ごと（company_id）。空なら全取引先で使う。読むのはメンバー、足す・消すのはオーナー（設定と同じ）
-- 2) マイページの報告に、言いかえ表と「同じ現場の全員の報告」を足す（2人以上の現場は代表の1人が全員分をまとめて送るため）。
--    返すのは名前・役割・件数・コメントだけ（電話番号・金額・マイページの鍵は返さない）
-- =============================================================================

create table public.item_aliases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies (id),
  alias text not null check (length(btrim(alias)) > 0 and length(alias) <= 100),
  item_id uuid not null references public.items (id),
  created_at timestamptz not null default now()
);

-- 同じ取引先で同じ書き方は1つだけ（大文字・小文字、前後の空白は区別しない）
create unique index item_aliases_unique on public.item_aliases (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(alias)));
create index item_aliases_company_idx on public.item_aliases (company_id);

alter table public.item_aliases enable row level security;
create policy "item_aliases: 読むのはメンバー" on public.item_aliases
  for select to authenticated using ((select public.is_member()));
create policy "item_aliases: 足すのはオーナー" on public.item_aliases
  for insert to authenticated with check ((select public.is_owner()));
create policy "item_aliases: 直すのはオーナー" on public.item_aliases
  for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy "item_aliases: 消すのはオーナー" on public.item_aliases
  for delete to authenticated using ((select public.is_owner()));

-- -----------------------------------------------------------------------------
-- マイページの報告: 言いかえ表と、同じ現場の全員の報告（名前・役割・件数・コメント）を足す
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
    'expenses', coalesce((
      select jsonb_object_agg(x.kind, jsonb_build_object('amount', x.amount, 'memo', x.memo, 'status', x.status))
      from public.expenses x where x.assignment_id = a.id
    ), '{}'::jsonb),
    -- この現場の取引先で使う書式（取引先の専用の書式を先に）
    'formats', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', f.id, 'name', f.name, 'header', f.header, 'event_block', f.event_block, 'person_block', f.person_block, 'footer', f.footer)
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
