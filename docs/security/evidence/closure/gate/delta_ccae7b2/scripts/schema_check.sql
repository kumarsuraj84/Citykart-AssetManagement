-- GT step 3: what the four packaged migrations left behind (read-only).
\pset footer off
select version_num as alembic_version from alembic_version;
select column_name, data_type, is_nullable, column_default from information_schema.columns
 where table_name='asset_user' and column_name='token_version';
select token_version, count(*) as asset_users from asset_user group by 1 order by 1;
select to_regclass('public.auth_session') as auth_session_table, (select count(*) from auth_session) as auth_session_rows;
select indexname from pg_indexes where tablename='auth_session' order by 1;
select tgrelid::regclass as tbl, tgname, case when tgtype & 32 = 32 then 'TRUNCATE' when tgtype & 16 = 16 then 'UPDATE' when tgtype & 8 = 8 then 'DELETE' else tgtype::text end as fires_on, tgenabled
  from pg_trigger where not tgisinternal order by 1, 2;
select proname from pg_proc where proname in ('forbid_append_only_truncate','forbid_asset_lifecycle_write','forbid_audit_log_write','ckam_purge_audit_log') order by 1;
select prosrc like '%5 years%' as audit_purge_floor_5y from pg_proc where proname='forbid_audit_log_write';
select status, count(*) from asset group by 1 order by 1;
select count(*) as assets, count(*) filter (where status is null or current_asset_user_id is null) as assets_missing_state from asset;
