-- GT step 6: what a downgrade left behind (read-only).
\pset footer off
select version_num from alembic_version;
select exists(select 1 from information_schema.columns where table_name='asset_user' and column_name='token_version') as token_version_column;
select to_regclass('public.auth_session') as auth_session_table;
select tgrelid::regclass as tbl, tgname from pg_trigger where not tgisinternal and (tgname like '%truncate%' or tgname like '%lifecycle%') order by 1, 2;
select proname, case when prosrc like '%5 years%' then '5-year floor' when prosrc like '%1 day%' then '1-day floor' when prosrc like '%append-only%' then 'no floor in body' else '-' end as purge_rule
  from pg_proc where proname in ('forbid_audit_log_write', 'ckam_purge_audit_log', 'forbid_append_only_truncate', 'forbid_asset_lifecycle_write') order by 1;
select count(*) as assets, count(*) filter (where status is not null and current_asset_user_id is not null) as assets_with_state from asset;
select count(*) as asset_events from asset_event;
select count(*) as audit_rows from audit_log;
