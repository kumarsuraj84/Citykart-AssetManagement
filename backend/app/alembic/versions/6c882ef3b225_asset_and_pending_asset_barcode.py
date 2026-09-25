"""asset and pending_asset barcode

Revision ID: 6c882ef3b225
Revises: 8c5638e1b65e
Create Date: 2026-09-25 00:00:00.000000

CityKart's own internal inventory barcode (docs/ai/DECISIONS.md), distinct
from the manufacturer Serial Number -- deliberately not unique, since the
same barcode value may legitimately appear on more than one asset. Entered
once per PO line (add_pending_asset_line) and carried through delivery onto
the converted Asset (procure_assets), exactly like every other pending-line
attribute. Additive, nullable columns on both tables -- no data migration.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '6c882ef3b225'
down_revision: Union[str, Sequence[str], None] = '8c5638e1b65e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('asset', sa.Column('barcode', sa.String(length=200), nullable=True))
    op.add_column('pending_asset', sa.Column('barcode', sa.String(length=200), nullable=True))


def downgrade() -> None:
    op.drop_column('pending_asset', 'barcode')
    op.drop_column('asset', 'barcode')
