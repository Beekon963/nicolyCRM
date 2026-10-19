-- =============================================================================
-- Phase 16: 会社の経費
--
-- オーナーが立て替えた会社の経費（飲食・通信・ソフト・備品など）を記録する。今までのスプレッドシート
-- （払った人ごとのシート: 日付・買ったもの・支払先・用途・区分・金額（税込）・領収書・メモ・参加者）の置きかえ。
-- - ★ 金額があるので、オーナーだけが読み書きできる（管理者からは 0 件。画面も出さない）
-- - 消さずに「取り消し」にする（voided_at）。取り消した経費は合計に入れない
-- - 領収書の写真は非公開の receipts バケット（オーナーだけ）。今のシートから取り込んだものは URL を残す
-- - スタッフが現場ごとに申請する「交通費・経費」（expenses）とは別のもの
-- =============================================================================

create table public.company_expenses (
  id uuid primary key default gen_random_uuid(),
  -- 払った（立て替えた）人。null は「まだ決めていない」（今のシートの「未振分」）
  paid_by uuid references public.app_users (id),
  -- 使った日（日本時間の暦日）
  spent_on date not null,
  -- 店・支払先
  vendor text not null default '' check (length(vendor) <= 100),
  -- 買ったもの・サービス
  item text not null default '' check (length(item) <= 200),
  -- 用途（何のためか）
  purpose text not null default '' check (length(purpose) <= 200),
  -- 区分（飲食・交通・通信・ソフト など）。決まった一覧にはせず、前に使った区分を候補に出す
  category text not null default '' check (length(category) <= 30),
  -- 金額（税込・円）
  amount integer not null check (amount between 1 and 99999999),
  -- 参加者（飲食のときなど）
  attendees text not null default '' check (length(attendees) <= 300),
  memo text not null default '' check (length(memo) <= 500),
  -- 領収書の写真（receipts バケットの中の場所）
  receipt_path text check (length(receipt_path) between 1 and 200),
  -- 今のシートから取り込んだ領収書の URL
  receipt_url text not null default '' check (length(receipt_url) <= 1000),
  -- 取り消した日時（消さずに残す。合計に入れない）
  voided_at timestamptz,
  created_by uuid references public.app_users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 店か買ったもののどちらかは入れる（今のシートは「買ったもの」に店の名前が入っている行もある）
  constraint company_expenses_what check (length(trim(vendor)) > 0 or length(trim(item)) > 0)
);

create index company_expenses_spent_on_idx on public.company_expenses (spent_on desc);
create index company_expenses_paid_by_idx on public.company_expenses (paid_by);

create trigger company_expenses_updated_at before update on public.company_expenses
  for each row execute function public.set_updated_at();
-- 金額の変更は変更履歴に残す（CLAUDE.md「DB・権限」）
create trigger company_expenses_audit after insert or update or delete on public.company_expenses
  for each row execute function public.audit_trigger('id');

alter table public.company_expenses enable row level security;
create policy "company_expenses: オーナーが読める" on public.company_expenses
  for select to authenticated using ((select public.is_owner()));
create policy "company_expenses: オーナーが追加" on public.company_expenses
  for insert to authenticated with check ((select public.is_owner()));
create policy "company_expenses: オーナーが変更" on public.company_expenses
  for update to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
-- 消すポリシーは作らない（取り消しは voided_at）

-- -----------------------------------------------------------------------------
-- 領収書の写真（非公開バケット、オーナーのみ）。画面で小さくした JPEG を入れる
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "receipts: オーナーが読める" on storage.objects
  for select to authenticated using (bucket_id = 'receipts' and (select public.is_owner()));
create policy "receipts: オーナーが追加" on storage.objects
  for insert to authenticated with check (bucket_id = 'receipts' and (select public.is_owner()));
-- 経費の登録に失敗したときに、入れたばかりの写真を片付けるためだけに使う
create policy "receipts: オーナーが削除" on storage.objects
  for delete to authenticated using (bucket_id = 'receipts' and (select public.is_owner()));
