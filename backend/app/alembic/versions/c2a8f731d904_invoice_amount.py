"""invoice amount

Revision ID: c2a8f731d904
Revises: b7f4a1d92e6c
Create Date: 2026-09-29 00:00:00.000000

AM-19: Invoice Amount becomes a real field on the Asset -- previously it
was only captured transiently on the PO Delivery Done payload
(DeliveryDoneIn.invoice_amount, still stored per-line on pending_asset)
and never copied onto the Asset itself, so there was nowhere on Asset 360
to see or correct it. Additive, nullable -- no backfill of existing rows.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c2a8f731d904'
down_revision: Union[str, Sequence[str], None] = 'b7f4a1d92e6c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('asset', sa.Column('invoice_amount', sa.Numeric(14, 2), nullable=True))


def downgrade() -> None:
    op.drop_column('asset', 'invoice_amount')
