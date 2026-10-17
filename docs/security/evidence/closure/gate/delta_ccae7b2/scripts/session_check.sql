-- GT: sessions and ledger after the new code ran (read-only).
\pset footer off
select version_num from alembic_version;
select count(*) as auth_session_rows, count(distinct asset_user_id) as people, count(*) filter (where revoked_at is not null) as revoked from auth_session;
select token_version, count(*) from asset_user group by 1 order by 1;
select count(*) as asset_events, max(id) as max_event_id from asset_event;
select count(*) as audit_rows from audit_log;
select a.id, a.asset_code, a.status, a.current_asset_user_id, (select e.status_after from asset_event e where e.asset_id=a.id order by e.id desc limit 1) as last_event_status
  from asset a order by a.id;
select count(*) as assets_out_of_step_with_ledger from asset a
 where a.status is distinct from (select e.status_after from asset_event e where e.asset_id=a.id and e.event_type <> 'CORRECTION' order by e.id desc limit 1);
