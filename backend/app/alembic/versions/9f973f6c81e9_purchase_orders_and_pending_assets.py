"""purchase orders and pending assets

Revision ID: 9f973f6c81e9
Revises: f28b6a913dce
Create Date: 2026-09-25 00:00:00.000000

New, additive-only tables for the PO / pre-delivery staging workflow
(docs/specs/2026-09-25-po-pending-assets-design.md). No existing table
changes. A PendingAsset converts into a real Asset via the existing
app.assets.service.procure_assets path -- this migration adds no new
ledger or numbering logic, just the staging tables themselves.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '9f973f6c81e9'
down_revision: Union[str, Sequence[str], None] = 'f28b6a913dce'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'purchase_order',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.BigInteger(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_by', sa.BigInteger(), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('company_id', sa.BigInteger(), nullable=False),
        sa.Column('po_number', sa.String(length=100), nullable=False),
        sa.Column('po_date', sa.Date(), nullable=False),
        sa.Column('vendor_id', sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(['company_id'], ['company.id']),
        sa.ForeignKeyConstraint(['vendor_id'], ['vendor.id']),
        sa.ForeignKeyConstraint(['created_by'], ['holder.id']),
        sa.ForeignKeyConstraint(['updated_by'], ['holder.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_purchase_order_company_id', 'purchase_order', ['company_id'])

    op.create_table(
        'pending_asset',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.BigInteger(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_by', sa.BigInteger(), nullable=True),
        sa.Column('purchase_order_id', sa.BigInteger(), nullable=False),
        sa.Column('company_id', sa.BigInteger(), nullable=False),
        sa.Column('description', sa.String(length=500), nullable=False),
        sa.Column('category_id', sa.BigInteger(), nullable=False),
        sa.Column('subcategory_id', sa.BigInteger(), nullable=True),
        sa.Column('cost_center_id', sa.BigInteger(), nullable=False),
        sa.Column('purchase_cost', sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column('tax_percent', sa.Numeric(precision=5, scale=2), nullable=True),
        sa.Column('tax_amount', sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column('total_cost', sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='PENDING'),
        sa.Column('serial_number', sa.String(length=200), nullable=True),
        sa.Column('invoice_number', sa.String(length=100), nullable=True),
        sa.Column('invoice_date', sa.Date(), nullable=True),
        sa.Column('invoice_amount', sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column('initial_holder_id', sa.BigInteger(), nullable=True),
        sa.Column('delivered_asset_id', sa.BigInteger(), nullable=True),
        sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('delivered_by', sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(['purchase_order_id'], ['purchase_order.id']),
        sa.ForeignKeyConstraint(['company_id'], ['company.id']),
        sa.ForeignKeyConstraint(['category_id'], ['asset_category.id']),
        sa.ForeignKeyConstraint(['subcategory_id'], ['asset_subcategory.id']),
        sa.ForeignKeyConstraint(['cost_center_id'], ['cost_center.id']),
        sa.ForeignKeyConstraint(['initial_holder_id'], ['holder.id']),
        sa.ForeignKeyConstraint(['delivered_asset_id'], ['asset.id']),
        sa.ForeignKeyConstraint(['delivered_by'], ['holder.id']),
        sa.ForeignKeyConstraint(['created_by'], ['holder.id']),
        sa.ForeignKeyConstraint(['updated_by'], ['holder.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_pending_asset_purchase_order_id', 'pending_asset', ['purchase_order_id'])
    op.create_index('ix_pending_asset_company_id_status', 'pending_asset', ['company_id', 'status'])


def downgrade() -> None:
    op.drop_index('ix_pending_asset_company_id_status', table_name='pending_asset')
    op.drop_index('ix_pending_asset_purchase_order_id', table_name='pending_asset')
    op.drop_table('pending_asset')
    op.drop_index('ix_purchase_order_company_id', table_name='purchase_order')
    op.drop_table('purchase_order')
