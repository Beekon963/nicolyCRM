-- =============================================================================
-- Phase 6: 会場ごとの色
--
-- 稼働表で、上の段の現場と下の段のスタッフのマスを会場の色でそろえ、誰がどこへ行くか一目で分かるようにする。
-- - 色は決まった7色から選ぶ（赤・黄・緑は「欠員・打診中・埋まった」専用なので使わない）
--   色の中身（色の値・名前）は src/lib/venue-colors.ts。ここでは名前（キー）だけを持つ
-- - 新しい会場には、いま一番使われていない色を自動で付ける（会場の画面で変えられる）
-- - 見るだけリンクにも会場の色を出す（board_json に venue_color を足す。金額・電話番号は今までどおり出さない）
-- =============================================================================

-- '' は「自動で決める」の印（入れるときにトリガーが色に置き換える。'' のままでは入らない）
alter table public.venues add column color text not null default '';

-- 今ある会場に、作った順で色を順番に付ける
with o as (select id, row_number() over (order by created_at, name, id) - 1 as n from public.venues)
update public.venues v
   set color = (array['blue', 'navy', 'sky', 'purple', 'lavender', 'pink', 'brown'])[1 + (o.n % 7)::int]
  from o
 where o.id = v.id;

alter table public.venues
  add constraint venues_color_check check (color in ('blue', 'navy', 'sky', 'purple', 'lavender', 'pink', 'brown'));

-- 新しい会場: 色が決まっていなければ、使っている会場が一番少ない色にする（同じ数なら並びの先の色）
create or replace function public.venues_default_color()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.color is null or new.color = '' then
    select p.c into new.color
      from unnest(array['blue', 'navy', 'sky', 'purple', 'lavender', 'pink', 'brown']) with ordinality as p(c, i)
      left join public.venues v on v.color = p.c and v.is_active
     group by p.c, p.i
     order by count(v.id), p.i
     limit 1;
  end if;
  return new;
end;
$$;

create trigger venues_default_color
  before insert on public.venues
  for each row execute function public.venues_default_color();

-- 稼働表の中身（見るだけリンク・書き出しで共通）。前のマイグレーションの内容に、会場の色だけ足した
create or replace function public.board_json(m_start date, m_end date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return jsonb_build_object(
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'date', o.date,
        'client_id', o.client_id, 'client_name', c.name,
        'venue_id', o.venue_id, 'venue_name', v.name, 'venue_color', v.color,
        'required_total', o.required_total, 'confirmed_total', o.confirmed_total, 'shortage_total', o.shortage_total,
        'cancelled', o.cancelled_at is not null
      ) order by o.date)
      from public.event_overview o
      join public.companies c on c.id = o.client_id
      join public.venues v on v.id = o.venue_id
      where o.date between m_start and m_end
    ), '[]'::jsonb),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'event_id', a.event_id, 'staff_id', a.staff_id, 'role_id', a.role_id, 'status', a.status))
      from public.assignments a join public.events e on e.id = a.event_id
      where a.status = 'confirmed' and e.cancelled_at is null and e.date between m_start and m_end
    ), '[]'::jsonb),
    'availability', coalesce((
      select jsonb_agg(jsonb_build_object('staff_id', av.staff_id, 'date', av.date, 'status', av.status))
      from public.availability av join public.staff s on s.id = av.staff_id
      where av.date between m_start and m_end and s.status = 'active'
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'kana', s.kana, 'nearest_station', s.nearest_station,
        'rank_name', r.name, 'rank_order', r.sort_order
      ))
      from public.staff s left join public.ranks r on r.id = s.rank_id
      where s.status = 'active'
         or exists (
           select 1 from public.assignments a join public.events e on e.id = a.event_id
            where a.staff_id = s.id and a.status = 'confirmed' and e.cancelled_at is null and e.date between m_start and m_end
         )
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.board_json(date, date) from public, anon, authenticated;
