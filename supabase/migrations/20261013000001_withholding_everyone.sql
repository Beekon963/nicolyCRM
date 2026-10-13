-- =============================================================================
-- Phase 13: 源泉徴収は全員を対象にする（2026-10-13 のご回答。今の支払明細書と同じ計算）
--
-- - 全員を「報酬・料金」（10.21%。控除なし）にする。これから登録する人も最初から対象。
--   対象外の人（会社など）は、スタッフの「お金・契約」で人ごとに「なし」にする
-- - 源泉徴収は本体価格（税込 ÷ 1.1 の円未満切捨て）にかける（お金の設定の「税込の額で計算する」をオフ）
-- 金額は扱わない（方式と計算のしかただけ）
-- =============================================================================

alter table public.staff_private alter column withholding_method set default 'fee';

update public.staff_private set withholding_method = 'fee' where withholding_method = 'none';

-- まだ「お金・契約」の行がない人にも作っておく（画面と計算の両方で「報酬・料金」になるように）
insert into public.staff_private (staff_id)
select s.id from public.staff s
where not exists (select 1 from public.staff_private p where p.staff_id = s.id);

-- 源泉徴収は本体価格（税抜）にかける
insert into public.owner_settings (key, value) values ('withholding', '{"include_expenses": true, "tax_inclusive": false}')
on conflict (key) do update set value = jsonb_set(public.owner_settings.value, '{tax_inclusive}', 'false');
