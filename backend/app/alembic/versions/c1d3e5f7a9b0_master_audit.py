"""Append-only audit of work-area-owned masters: master_audit

Revision ID: c1d3e5f7a9b0
Revises: b8d0f2a4c6e8
Create Date: 2026-10-13 16:00:00.000000

S3a-1 (simplification programme): ordinary ADMINs may now create, edit and
deactivate Categories, Sub-categories and Items of their own work area (IT or
Non-IT), and a both-area admin may move a Category or Item to the other work
area. Every such change is written to this new table, one row per changed
field (entity, entity_id, field, old_value, new_value, actor_id, changed_at).

Additive only: one new table plus its index, and the same append-only
enforcement as asset_event / asset_field_change (a trigger refuses UPDATE and
DELETE). No existing table or row changes. Downgrade drops the triggers, the
function and the table.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c1d3e5f7a9b0'
down_revision: Union[str, Sequence[str], None] = 'b8d0f2a4c6e8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'master_audit',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('entity', sa.String(length=30), nullable=False),
        sa.Column('entity_id', sa.BigInteger(), nullable=False),
        sa.Column('field', sa.String(length=100), nullable=False),
        sa.Column('old_value', sa.String(length=1000), nullable=True),
        sa.Column('new_value', sa.String(length=1000), nullable=True),
        sa.Column('actor_id', sa.BigInteger(), nullable=False),
        sa.Column('changed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['actor_id'], ['asset_user.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_master_audit_entity', 'master_audit', ['entity', 'entity_id', 'changed_at', 'id'])
    op.execute("""
        CREATE OR REPLACE FUNCTION forbid_master_audit_write() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'master_audit rows are append-only';
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER trg_master_audit_no_update
        BEFORE UPDATE ON master_audit
        FOR EACH ROW EXECUTE FUNCTION forbid_master_audit_write();
    """)
    op.execute("""
        CREATE TRIGGER trg_master_audit_no_delete
        BEFORE DELETE ON master_audit
        FOR EACH ROW EXECUTE FUNCTION forbid_master_audit_write();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_master_audit_no_delete ON master_audit;")
    op.execute("DROP TRIGGER IF EXISTS trg_master_audit_no_update ON master_audit;")
    op.execute("DROP FUNCTION IF EXISTS forbid_master_audit_write;")
    op.drop_index('ix_master_audit_entity', table_name='master_audit')
    op.drop_table('master_audit')
