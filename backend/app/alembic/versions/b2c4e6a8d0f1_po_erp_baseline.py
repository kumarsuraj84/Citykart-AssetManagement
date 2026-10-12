"""Purchase orders made from the ERP: what the ERP said, and what was done about later changes

Revision ID: b2c4e6a8d0f1
Revises: a1d3f5b7c9e2
Create Date: 2026-10-12 10:00:00.000000

A CKAM PO made from an ERP PO is a copy. To tell "the ERP changed this PO since you made it"
(cancelled, quantity or rate edited, a line added) CKAM remembers what the ERP said when the PO
was made, or when its changes were last looked at: purchase_order.erp_status / erp_supplier_code /
erp_delivery_location / erp_synced_at for the header, purchase_order_erp_baseline for each item
code (quantity after cancellations, rate, tax %). purchase_order_erp_change logs every change a
person applied or kept. Additive; existing POs have no baseline until someone starts watching them.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b2c4e6a8d0f1'
down_revision: Union[str, Sequence[str], None] = 'a1d3f5b7c9e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('purchase_order', sa.Column('erp_status', sa.String(length=30), nullable=True))
    op.add_column('purchase_order', sa.Column('erp_supplier_code', sa.String(length=50), nullable=True))
    op.add_column('purchase_order', sa.Column('erp_delivery_location', sa.String(length=200), nullable=True))
    op.add_column('purchase_order', sa.Column('erp_synced_at', sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        'purchase_order_erp_baseline',
        sa.Column('id', sa.BigInteger(), primary_key=True),
        sa.Column('purchase_order_id', sa.BigInteger(), sa.ForeignKey('purchase_order.id'), nullable=False),
        sa.Column('item_code', sa.String(length=50), nullable=False),
        sa.Column('qty', sa.Numeric(14, 3), nullable=False),
        sa.Column('rate', sa.Numeric(14, 4), nullable=False),
        sa.Column('tax_percent', sa.Numeric(6, 2), nullable=True),
        sa.UniqueConstraint('purchase_order_id', 'item_code', name='uq_po_erp_baseline_item'),
    )
    op.create_table(
        'purchase_order_erp_change',
        sa.Column('id', sa.BigInteger(), primary_key=True),
        sa.Column('purchase_order_id', sa.BigInteger(), sa.ForeignKey('purchase_order.id'), nullable=False),
        sa.Column('actor_id', sa.BigInteger(), sa.ForeignKey('asset_user.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('kind', sa.String(length=30), nullable=False),
        sa.Column('item_code', sa.String(length=50), nullable=True),
        sa.Column('summary', sa.String(length=500), nullable=False),
    )
    op.create_index('ix_po_erp_change_po', 'purchase_order_erp_change', ['purchase_order_id'])


def downgrade() -> None:
    op.drop_index('ix_po_erp_change_po', table_name='purchase_order_erp_change')
    op.drop_table('purchase_order_erp_change')
    op.drop_table('purchase_order_erp_baseline')
    op.drop_column('purchase_order', 'erp_synced_at')
    op.drop_column('purchase_order', 'erp_delivery_location')
    op.drop_column('purchase_order', 'erp_supplier_code')
    op.drop_column('purchase_order', 'erp_status')
