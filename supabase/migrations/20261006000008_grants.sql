-- =============================================================================
-- 権限の締め付け（RLS に加えた二重の守り）
--
-- Supabase の初期設定では、ログインしていない利用者（anon）にも全テーブル・全関数の
-- 権限が付いている。データは RLS で守られているが、念のため anon からは外し、
-- マイページ用の関数だけを個別に許可する（mypage マイグレーション）。
-- 以後のマイグレーションで作る関数・テーブルにも同じ設定がかかるよう、既定の権限も変える。
-- =============================================================================

-- テーブル・ビュー
revoke all on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from authenticated;

-- シーケンス
revoke all on all sequences in schema public from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

-- 関数（PostgreSQL は既定で全員に実行権限を付けるので、それも外す）
revoke execute on all functions in schema public from public, anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres revoke execute on functions from public;
