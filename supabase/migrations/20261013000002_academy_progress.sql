-- =============================================================================
-- Phase 14: NICOLY アカデミーの進み具合
--
-- アカデミーの管理画面の CSV（nicoly-progress.csv）を CRM に取り込み、スタッフごとの
-- 称号・分野の進み具合・知識テスト・総合ロープレ・現場チェック・稼働判断を見られるようにする。
-- - 1人1行（いちばん新しく取り込んだもの）。アカデミーの ID でスタッフと結びつける（次からは自動で当たる）
-- - お金の情報はないので、オーナー・管理者が読める・取り込める。スタッフのマイページには出さない
-- - アカデミーの記録の写しなので、間違えて結びつけたときは外せる（行を消す。アカデミーの記録は消えない）
-- =============================================================================

create table public.academy_progress (
  staff_id uuid primary key references public.staff (id),
  -- アカデミーの ID（ログインに使う ID）。1つの ID は1人のスタッフにだけ結びつく
  academy_id text not null unique check (length(trim(academy_id)) between 1 and 64),
  -- アカデミーでの氏名（取り込んだときの確かめ用）
  academy_name text not null default '' check (length(academy_name) <= 100),
  -- アカデミーで利用中か（停止中なら false）
  active boolean not null default true,
  -- ロードマップ（学習済みの章とテストの合計 / 全部の数）。金額の列と見分けるため total という名前は使わない
  roadmap_done smallint check (roadmap_done between 0 and 999),
  roadmap_steps smallint check (roadmap_steps between 0 and 999),
  -- 称号（「見習い」「携帯を案内できる」など。アカデミーの書き方のまま）
  title text not null default '' check (length(title) <= 100),
  -- 分野ごと [{ "name": "携帯", "done": 8, "total": 8, "test": true }, …]
  areas jsonb not null default '[]'::jsonb check (jsonb_typeof(areas) = 'array'),
  -- 知識テスト（合格 / 旧版で合格 / 未合格（最新 〇点） / 未受験）
  knowledge text not null default '' check (length(knowledge) <= 100),
  knowledge_ok boolean not null default false,
  -- 総合ロープレ（実技合格 / 依頼中 / まだ）
  roleplay text not null default '' check (length(roleplay) <= 100),
  roleplay_ok boolean not null default false,
  -- 現場チェック（達成した項目 / 全部の項目）
  field_done smallint check (field_done between 0 and 999),
  field_items smallint check (field_items between 0 and 999),
  -- 稼働判断: ready = 稼働可 / hold = 保留 / none = 未判定
  decision text not null default 'none' check (decision in ('ready', 'hold', 'none')),
  hearing_count smallint not null default 0 check (hearing_count between 0 and 999),
  -- 初回ガイド（読了 / スキップ / 未）
  guide text not null default '' check (length(guide) <= 20),
  last_studied_at timestamptz,
  imported_at timestamptz not null default now(),
  imported_by uuid references public.app_users (id) default auth.uid()
);

alter table public.academy_progress enable row level security;
create policy "academy_progress: 利用者は読める" on public.academy_progress
  for select to authenticated using ((select public.is_member()));
create policy "academy_progress: 利用者が取り込む" on public.academy_progress
  for insert to authenticated with check ((select public.is_member()));
create policy "academy_progress: 利用者が更新" on public.academy_progress
  for update to authenticated using ((select public.is_member())) with check ((select public.is_member()));
create policy "academy_progress: 利用者が外す" on public.academy_progress
  for delete to authenticated using ((select public.is_member()));
