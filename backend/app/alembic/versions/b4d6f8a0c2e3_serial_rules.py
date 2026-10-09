"""Serial-number rule on Categories and Sub-Categories

Revision ID: b4d6f8a0c2e3
Revises: a9c3e5d7b1f4
Create Date: 2026-10-10 18:00:00.000000

asset_category.serial_required (yes/no, default yes) and
asset_subcategory.serial_required (yes / no / NULL = same as the category) say
whether items of that kind carry a serial number, so PO lines and Add Asset
start with "No serial number" ticked for a mouse and ask for serials for a CPU.
It is only ever a default: a serial can still be typed, and a missing one can
still be saved as N/A. bundle_part.serial_required (never released) is dropped:
a bundle part now takes the rule from its own category/sub-category. Existing
rows behave as before (every category = yes).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b4d6f8a0c2e3'
down_revision: Union[str, Sequence[str], None] = 'a9c3e5d7b1f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('asset_category', sa.Column('serial_required', sa.Boolean(), server_default='true', nullable=False))
    op.add_column('asset_subcategory', sa.Column('serial_required', sa.Boolean(), nullable=True))
    op.drop_column('bundle_part', 'serial_required')


def downgrade() -> None:
    op.add_column('bundle_part', sa.Column('serial_required', sa.Boolean(), server_default='true', nullable=False))
    op.drop_column('asset_subcategory', 'serial_required')
    op.drop_column('asset_category', 'serial_required')
