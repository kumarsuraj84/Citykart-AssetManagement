\echo == REFRESH_REUSE / REFRESH_DUPLICATE audit rows (last 15 min) ==
SELECT action, outcome, actor_code, left(summary,80) AS summary, changes
FROM audit_log WHERE action IN ('REFRESH_REUSE','REFRESH_DUPLICATE')
AND at > now() - interval '15 min' ORDER BY at DESC LIMIT 10;
\echo == does any audit_log.changes/summary contain the raw cookie signature fragment? ==
SELECT count(*) AS leak_audit FROM audit_log
WHERE at > now() - interval '30 min'
AND (summary LIKE '%dNYJlKiVWzuQc9WC-4R_Uxic%' OR changes::text LIKE '%dNYJlKiVWzuQc9WC-4R_Uxic%');
\echo == any JWT-looking value (eyJ...) stored in audit_log.changes in last 30 min? ==
SELECT count(*) AS jwt_in_audit FROM audit_log WHERE at > now() - interval '30 min' AND changes::text LIKE '%eyJ%';
\echo == auth_session: confirm only hashes stored, no raw token column; sample hashes ==
SELECT id, asset_user_id, revoked_reason, left(current_jti_hash,12) AS cur, left(coalesce(previous_jti_hash,''),12) AS prev, left(coalesce(legacy_token_hash,''),12) AS legacy FROM auth_session WHERE asset_user_id IN (48,49) ORDER BY id DESC LIMIT 12;
\echo == any cookie fragment in auth_session hash cols? (should be 0; hashes are hex sha256) ==
SELECT count(*) AS leak_session FROM auth_session WHERE current_jti_hash LIKE '%dNYJlKiVWzuQc9WC%' OR previous_jti_hash LIKE '%dNYJlKiVWzuQc9WC%';
\echo == error_log in last 30 min referencing tokens ==
SELECT count(*) AS leak_error FROM error_log WHERE at > now() - interval '30 min' AND (message LIKE '%eyJ%' OR message LIKE '%dNYJlKiVWzuQc9WC%' OR coalesce(stack,'') LIKE '%eyJ%');
