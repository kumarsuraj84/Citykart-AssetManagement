"""Serial pending: items whose serial is read later, when the box is opened

Revision ID: a1d3f5b7c9e2
Revises: f8b1d3e5a7c9
Create Date: 2026-10-11 16:00:00.000000

Some things (an amplifier) show no serial on the box; it is read in the store
after the box is opened. item.serial_later says so, pending_asset.serial_later
snapshots it onto a PO line, and asset.serial_pending marks an asset whose
serial is still to be filled in (serial_number stays empty until then). Pending
is a third state beside "has a serial" and "genuinely none" (N/A), so a serial
that was never filled can be listed and chased, and is never confused with N/A.
Additive; every existing row is false.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a1d3f5b7c9e2'
down_revision: Union[str, Sequence[str], None] = 'f8b1d3e5a7c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('item', sa.Column('serial_later', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('pending_asset', sa.Column('serial_later', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('asset', sa.Column('serial_pending', sa.Boolean(), server_default='false', nullable=False))
    op.execute("CREATE INDEX ix_asset_serial_pending ON asset (id) WHERE serial_pending AND deleted_at IS NULL")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_asset_serial_pending")
    op.drop_column('asset', 'serial_pending')
    op.drop_column('pending_asset', 'serial_later')
    op.drop_column('item', 'serial_later')
