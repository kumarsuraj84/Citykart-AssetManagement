"""S8: audit trail, error log, system events and client reports

Revision ID: e6f8a0b2c4d6
Revises: d2e4f6a8b0c2
Create Date: 2026-10-14 10:00:00.000000

Four new tables (app.observability.models), none with a foreign key so a log row never blocks or is
blocked by a business row:

1. `audit_log` -- who did what to which record (DATA / SECURITY / ACCESS / IMPORT / EXPORT / ERP /
   LIFECYCLE / SYSTEM), with the request id that ties it to errors and the access log. APPEND-ONLY with
   the same trigger pattern as asset_event / asset_field_change / master_audit: UPDATE is always refused;
   DELETE is refused unless the transaction has set `ckam.allow_audit_purge = on`, which only the guarded
   archive function `ckam_purge_audit_log(before timestamptz)` is meant for (EXECUTE revoked from PUBLIC;
   unused by the application, for a future archive tool -- export first).
2. `error_log` -- unexpected errors, database errors, slow requests / slow SQL (redacted).
3. `system_event` -- start / stop, ERP copies, purges, migration mismatches, log-directory and database
   problems.
4. `client_report` -- problems reported by the browser.

Additive only: no existing table, column or row changes. Downgrade drops the function, the triggers and
the four tables.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'e6f8a0b2c4d6'
down_revision: Union[str, Sequence[str], None] = 'd2e4f6a8b0c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _at():
    return sa.Column('at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False)


def upgrade() -> None:
    op.create_table(
        'audit_log',
        sa.Column('id', sa.BigInteger(), nullable=False),
        _at(),
        sa.Column('request_id', sa.Text(), nullable=True),
        sa.Column('source', sa.Text(), server_default='api', nullable=False),
        sa.Column('actor_id', sa.BigInteger(), nullable=True),
        sa.Column('actor_code', sa.Text(), nullable=True),
        sa.Column('actor_name', sa.Text(), nullable=True),
        sa.Column('actor_role', sa.Text(), nullable=True),
        sa.Column('is_head_office_admin', sa.Boolean(), server_default='false', nullable=False),
        sa.Column('company_id', sa.BigInteger(), nullable=True),
        sa.Column('ip', sa.Text(), nullable=True),
        sa.Column('category', sa.Text(), nullable=False),
        sa.Column('action', sa.Text(), nullable=False),
        sa.Column('entity', sa.Text(), nullable=True),
        sa.Column('entity_id', sa.Text(), nullable=True),
        sa.Column('summary', sa.Text(), nullable=False),
        sa.Column('changes', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('outcome', sa.Text(), server_default='OK', nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_audit_log_at', 'audit_log', ['at'])
    op.create_index('ix_audit_log_entity', 'audit_log', ['entity', 'entity_id'])
    op.create_index('ix_audit_log_actor', 'audit_log', ['actor_id'])
    op.create_index('ix_audit_log_request', 'audit_log', ['request_id'])
    op.create_index('ix_audit_log_category_at', 'audit_log', ['category', 'at'])

    op.create_table(
        'error_log',
        sa.Column('id', sa.BigInteger(), nullable=False),
        _at(),
        sa.Column('request_id', sa.Text(), nullable=True),
        sa.Column('level', sa.Text(), nullable=False),
        sa.Column('source', sa.Text(), nullable=False),
        sa.Column('kind', sa.Text(), server_default='exception', nullable=False),
        sa.Column('exception_type', sa.Text(), nullable=True),
        sa.Column('message', sa.Text(), nullable=True),
        sa.Column('stack', sa.Text(), nullable=True),
        sa.Column('route', sa.Text(), nullable=True),
        sa.Column('method', sa.Text(), nullable=True),
        sa.Column('status_code', sa.Integer(), nullable=True),
        sa.Column('actor_id', sa.BigInteger(), nullable=True),
        sa.Column('actor_code', sa.Text(), nullable=True),
        sa.Column('ip', sa.Text(), nullable=True),
        sa.Column('user_agent', sa.Text(), nullable=True),
        sa.Column('context', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('fingerprint', sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_error_log_at', 'error_log', ['at'])
    op.create_index('ix_error_log_fingerprint', 'error_log', ['fingerprint'])
    op.create_index('ix_error_log_request', 'error_log', ['request_id'])

    op.create_table(
        'system_event',
        sa.Column('id', sa.BigInteger(), nullable=False),
        _at(),
        sa.Column('level', sa.Text(), server_default='INFO', nullable=False),
        sa.Column('component', sa.Text(), nullable=False),
        sa.Column('event', sa.Text(), nullable=False),
        sa.Column('message', sa.Text(), nullable=True),
        sa.Column('details', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('request_id', sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_system_event_at', 'system_event', ['at'])
    op.create_index('ix_system_event_component_at', 'system_event', ['component', 'at'])

    op.create_table(
        'client_report',
        sa.Column('id', sa.BigInteger(), nullable=False),
        _at(),
        sa.Column('request_id', sa.Text(), nullable=True),
        sa.Column('reference', sa.Text(), nullable=True),
        sa.Column('actor_id', sa.BigInteger(), nullable=True),
        sa.Column('actor_code', sa.Text(), nullable=True),
        sa.Column('route', sa.Text(), nullable=True),
        sa.Column('app_version', sa.Text(), nullable=True),
        sa.Column('user_agent', sa.Text(), nullable=True),
        sa.Column('kind', sa.Text(), nullable=False),
        sa.Column('message', sa.Text(), nullable=True),
        sa.Column('stack', sa.Text(), nullable=True),
        sa.Column('breadcrumbs', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('recent_requests', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('status', sa.Text(), server_default='NEW', nullable=False),
        sa.Column('fingerprint', sa.Text(), nullable=True),
        sa.Column('reviewed_by', sa.BigInteger(), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_client_report_at', 'client_report', ['at'])
    op.create_index('ix_client_report_request', 'client_report', ['request_id'])
    op.create_index('ix_client_report_reference', 'client_report', ['reference'])
    op.create_index('ix_client_report_fingerprint', 'client_report', ['fingerprint'])

    # audit_log is append-only. DELETE is allowed only inside a transaction that set
    # ckam.allow_audit_purge = on (the guarded archive function below); UPDATE never.
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
    op.execute("""
        CREATE TRIGGER trg_audit_log_no_update
        BEFORE UPDATE ON audit_log
        FOR EACH ROW EXECUTE FUNCTION forbid_audit_log_write();
    """)
    op.execute("""
        CREATE TRIGGER trg_audit_log_no_delete
        BEFORE DELETE ON audit_log
        FOR EACH ROW EXECUTE FUNCTION forbid_audit_log_write();
    """)
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
    op.execute("REVOKE ALL ON FUNCTION ckam_purge_audit_log(timestamptz) FROM PUBLIC;")


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS ckam_purge_audit_log(timestamptz);")
    op.execute("DROP TRIGGER IF EXISTS trg_audit_log_no_delete ON audit_log;")
    op.execute("DROP TRIGGER IF EXISTS trg_audit_log_no_update ON audit_log;")
    op.execute("DROP FUNCTION IF EXISTS forbid_audit_log_write();")
    for name in ('ix_client_report_fingerprint', 'ix_client_report_reference', 'ix_client_report_request',
                 'ix_client_report_at'):
        op.drop_index(name, table_name='client_report')
    op.drop_table('client_report')
    op.drop_index('ix_system_event_component_at', table_name='system_event')
    op.drop_index('ix_system_event_at', table_name='system_event')
    op.drop_table('system_event')
    for name in ('ix_error_log_request', 'ix_error_log_fingerprint', 'ix_error_log_at'):
        op.drop_index(name, table_name='error_log')
    op.drop_table('error_log')
    for name in ('ix_audit_log_category_at', 'ix_audit_log_request', 'ix_audit_log_actor', 'ix_audit_log_entity',
                 'ix_audit_log_at'):
        op.drop_index(name, table_name='audit_log')
    op.drop_table('audit_log')
