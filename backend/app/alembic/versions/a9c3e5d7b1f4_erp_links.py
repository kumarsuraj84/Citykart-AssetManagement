"""ERP links: which ERP vendor / purchase order a CKAM row came from

Revision ID: a9c3e5d7b1f4
Revises: f7a1d4c8b3e2
Create Date: 2026-10-10 15:00:00.000000

vendor.erp_vendor_code ties a CKAM vendor to its ERP supplier so matching
survives a rename; purchase_order.erp_po_code ties a PO to the ERP purchase
order it was created from, so it cannot be created twice and its receipts and
PIs can be looked up later. Both optional and unique when present. Additive.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a9c3e5d7b1f4'
down_revision: Union[str, Sequence[str], None] = 'f7a1d4c8b3e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('vendor', sa.Column('erp_vendor_code', sa.String(length=50), nullable=True))
    op.create_index('ux_vendor_erp_code', 'vendor', ['erp_vendor_code'], unique=True,
                    postgresql_where=sa.text('erp_vendor_code IS NOT NULL'))
    op.add_column('purchase_order', sa.Column('erp_po_code', sa.BigInteger(), nullable=True))
    op.create_index('ux_purchase_order_erp_code', 'purchase_order', ['erp_po_code'], unique=True,
                    postgresql_where=sa.text('erp_po_code IS NOT NULL'))


def downgrade() -> None:
    op.drop_index('ux_purchase_order_erp_code', table_name='purchase_order')
    op.drop_column('purchase_order', 'erp_po_code')
    op.drop_index('ux_vendor_erp_code', table_name='vendor')
    op.drop_column('vendor', 'erp_vendor_code')
