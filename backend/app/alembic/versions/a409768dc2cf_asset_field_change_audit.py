"""asset field change audit

Revision ID: a409768dc2cf
Revises: 3a44505b6b10
Create Date: 2026-09-24 07:13:10.411422

AM-04: a lightweight, append-only audit trail for edits made through PUT
/api/assets/{id} (editable descriptive/procurement fields only). Deliberately
separate from asset_event, which stays the business lifecycle ledger and is
untouched here. Additive and reversible: one new table, no changes to any
existing table.

Note: alembic's autogenerate also proposed dropping and recreating several
pre-existing partial/expression indexes on asset/asset_event/holder
(ix_asset_*_active, ix_asset_event_*, ux_holder_company_email_ci) -- these
are false positives (a known autogenerate limitation with partial/functional
indexes it can't diff cleanly against their WHERE-clause/expression form)
and were removed from this migration by hand. Nothing about those indexes
actually changes.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a409768dc2cf'
down_revision: Union[str, Sequence[str], None] = '3a44505b6b10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'asset_field_change',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('asset_id', sa.BigInteger(), nullable=False),
        sa.Column('field_name', sa.String(length=100), nullable=False),
        sa.Column('old_value', sa.String(length=1000), nullable=True),
        sa.Column('new_value', sa.String(length=1000), nullable=True),
        sa.Column('actor_id', sa.BigInteger(), nullable=False),
        sa.Column('request_id', sa.String(length=36), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['actor_id'], ['holder.id'], ),
        sa.ForeignKeyConstraint(['asset_id'], ['asset.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_asset_field_change_asset_id_created_at', 'asset_field_change', ['asset_id', 'created_at', 'id'],
    )

    # Same append-only enforcement pattern as asset_event (migration 0003) --
    # a field-change audit that could be quietly edited or deleted wouldn't
    # be an audit trail. A CORRECTION is made by writing a new PUT edit
    # (which writes new audit rows of its own), never by rewriting history.
    op.execute("""
        CREATE OR REPLACE FUNCTION forbid_asset_field_change_write() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'asset_field_change rows are append-only';
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER trg_asset_field_change_no_update
        BEFORE UPDATE ON asset_field_change
        FOR EACH ROW EXECUTE FUNCTION forbid_asset_field_change_write();
    """)
    op.execute("""
        CREATE TRIGGER trg_asset_field_change_no_delete
        BEFORE DELETE ON asset_field_change
        FOR EACH ROW EXECUTE FUNCTION forbid_asset_field_change_write();
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP TRIGGER IF EXISTS trg_asset_field_change_no_delete ON asset_field_change;")
    op.execute("DROP TRIGGER IF EXISTS trg_asset_field_change_no_update ON asset_field_change;")
    op.execute("DROP FUNCTION IF EXISTS forbid_asset_field_change_write;")
    op.drop_index('ix_asset_field_change_asset_id_created_at', table_name='asset_field_change')
    op.drop_table('asset_field_change')
