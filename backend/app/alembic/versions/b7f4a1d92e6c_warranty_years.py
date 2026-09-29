"""warranty years

Revision ID: b7f4a1d92e6c
Revises: 278437eb710e
Create Date: 2026-09-29 00:00:00.000000

AM-18: Warranty Years becomes the actual user input on every asset-creation
path (Add Asset, PO Delivery, Import); Warranty Upto stays a stored date
column but is now always server-computed from Warranty Years + Purchase
Date (see app.assets.service.compute_warranty_upto), never typed directly.

All three new columns are additive and nullable -- no backfill of existing
rows. `asset.warranty_years` stays NULL for every asset created before this
migration; its existing `warranty_upto` (whatever it already held, manually
entered or NULL) is left exactly as-is, never touched. `pending_asset`
gains `brand`/`model` (it never had them at all -- PO Add Line is gaining
parity with Add Asset here, a genuinely new capability, not a backfill) and
`warranty_years` (entered once per line, like barcode/description, and
carried onto the delivered Asset's own warranty_years at Delivery Done).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b7f4a1d92e6c'
down_revision: Union[str, Sequence[str], None] = '278437eb710e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('asset', sa.Column('warranty_years', sa.Integer(), nullable=True))
    op.add_column('pending_asset', sa.Column('brand', sa.String(length=200), nullable=True))
    op.add_column('pending_asset', sa.Column('model', sa.String(length=200), nullable=True))
    op.add_column('pending_asset', sa.Column('warranty_years', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('pending_asset', 'warranty_years')
    op.drop_column('pending_asset', 'model')
    op.drop_column('pending_asset', 'brand')
    op.drop_column('asset', 'warranty_years')
