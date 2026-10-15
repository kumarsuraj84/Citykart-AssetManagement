"""Security AU-10/IF-05/IF-06: append-only tables refuse TRUNCATE; the audit purge flag cannot remove recent rows

Revision ID: a3c5e7f9b1d4
Revises: f9a1c3e5b7d2
Create Date: 2026-10-15 11:00:00.000000

1. IF-05: the four append-only tables (asset_event, asset_field_change, master_audit, audit_log) refused
   UPDATE and DELETE row by row, but row triggers never fire on TRUNCATE, so one statement could empty a whole
   ledger. Each table now also has a statement-level BEFORE TRUNCATE trigger that raises an error.
2. IF-06: `forbid_audit_log_write` let ANY DELETE through when the transaction had set the custom setting
   `ckam.allow_audit_purge = on` -- and any role can set a custom setting, so the newest audit rows could be
   deleted. The setting now opens only rows older than a fixed floor of 5 years (written into the trigger
   function, not settable by a client); a recent row is refused whatever the session says. The guarded
   archive function `ckam_purge_audit_log` refuses a cut-off newer than the same floor. audit_log is never
   purged by the application (app.observability.retention), so the floor costs nothing today.

What this does NOT stop: the table owner (or a superuser) can still DROP / DISABLE these triggers. The real
fix is a separate low-privilege runtime role that owns nothing (see the security report).

The test suite empties every table before each test with TRUNCATE: it does so with
`SET LOCAL session_replication_role = replica` (tests/conftest.py), which skips ordinary triggers and which
only a superuser (the dev/test role) may set -- the application role in production cannot.

Downgrade restores the previous trigger function and archive function and drops the TRUNCATE triggers.
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'a3c5e7f9b1d4'
down_revision: Union[str, Sequence[str], None] = 'f9a1c3e5b7d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

APPEND_ONLY_TABLES = ("asset_event", "asset_field_change", "master_audit", "audit_log")


def upgrade() -> None:
    op.execute("""
        CREATE OR REPLACE FUNCTION forbid_append_only_truncate() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION '% rows are append-only; TRUNCATE is not allowed', TG_TABLE_NAME;
        END;
        $$ LANGUAGE plpgsql;
    """)
    for table in APPEND_ONLY_TABLES:
        op.execute(f"""
            CREATE TRIGGER trg_{table}_no_truncate
            BEFORE TRUNCATE ON {table}
            FOR EACH STATEMENT EXECUTE FUNCTION forbid_append_only_truncate();
        """)
    op.execute("""
        CREATE OR REPLACE FUNCTION forbid_audit_log_write() RETURNS trigger AS $$
        BEGIN
            -- The purge setting opens only rows older than 5 years; the floor is fixed here, not by the session.
            IF TG_OP = 'DELETE' AND coalesce(current_setting('ckam.allow_audit_purge', true), '') = 'on'
               AND OLD.at < now() - interval '5 years' THEN
                RETURN OLD;
            END IF;
            RAISE EXCEPTION 'audit_log rows are append-only';
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION ckam_purge_audit_log(p_before timestamptz) RETURNS bigint AS $$
        DECLARE
            removed bigint;
        BEGIN
            IF coalesce(current_setting('ckam.allow_audit_purge', true), '') <> 'on' THEN
                RAISE EXCEPTION 'audit_log purge is not allowed: export the rows first, then SET LOCAL ckam.allow_audit_purge = on in the same transaction';
            END IF;
            IF p_before IS NULL OR p_before > now() - interval '5 years' THEN
                RAISE EXCEPTION 'audit_log purge needs a cut-off date at least 5 years in the past';
            END IF;
            DELETE FROM audit_log WHERE at < p_before;
            GET DIAGNOSTICS removed = ROW_COUNT;
            RETURN removed;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("REVOKE ALL ON FUNCTION ckam_purge_audit_log(timestamptz) FROM PUBLIC;")


def downgrade() -> None:
    op.execute("""
        CREATE OR REPLACE FUNCTION ckam_purge_audit_log(p_before timestamptz) RETURNS bigint AS $$
        DECLARE
            removed bigint;
        BEGIN
            IF coalesce(current_setting('ckam.allow_audit_purge', true), '') <> 'on' THEN
                RAISE EXCEPTION 'audit_log purge is not allowed: export the rows first, then SET LOCAL ckam.allow_audit_purge = on in the same transaction';
            END IF;
            IF p_before IS NULL OR p_before > now() - interval '1 day' THEN
                RAISE EXCEPTION 'audit_log purge needs a cut-off date at least one day in the past';
            END IF;
            DELETE FROM audit_log WHERE at < p_before;
            GET DIAGNOSTICS removed = ROW_COUNT;
            RETURN removed;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE OR REPLACE FUNCTION forbid_audit_log_write() RETURNS trigger AS $$
        BEGIN
            IF TG_OP = 'DELETE' AND coalesce(current_setting('ckam.allow_audit_purge', true), '') = 'on' THEN
                RETURN OLD;
            END IF;
            RAISE EXCEPTION 'audit_log rows are append-only';
        END;
        $$ LANGUAGE plpgsql;
    """)
    for table in APPEND_ONLY_TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_no_truncate ON {table};")
    op.execute("DROP FUNCTION IF EXISTS forbid_append_only_truncate();")
