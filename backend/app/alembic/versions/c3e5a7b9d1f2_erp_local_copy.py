"""CKAM's own copy of the ERP purchase data (both companies)

Revision ID: c3e5a7b9d1f2
Revises: b2c4e6a8d0f1
Create Date: 2026-10-13 10:00:00.000000

Adds erp_sync_run (one row per copy run), erp_po_line (fixed-asset PO lines, key = company + the
warehouse's line key), erp_vendor (suppliers used by those lines, key = company + vendor code) and
erp_item (the ERP item codes they use). Additive; the ERP is only ever read. Rows are never
deleted: one the ERP stops returning is marked is_present = false.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c3e5a7b9d1f2'
down_revision: Union[str, Sequence[str], None] = 'b2c4e6a8d0f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _seen() -> list[sa.Column]:
    return [
        sa.Column('row_hash', sa.String(length=64), nullable=False),
        sa.Column('first_seen_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('is_present', sa.Boolean(), nullable=False, server_default='true'),
    ]


def upgrade() -> None:
    op.create_table(
        'erp_sync_run',
        sa.Column('id', sa.BigInteger(), primary_key=True),
        sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False),
        sa.Column('trigger', sa.String(length=20), nullable=False),
        sa.Column('source_stamp', sa.DateTime(timezone=True), nullable=True),
        sa.Column('message', sa.Text(), nullable=True),
        sa.Column('po_lines_new', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('po_lines_changed', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('po_lines_gone', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('vendors', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('items', sa.Integer(), nullable=False, server_default='0'),
    )
    op.create_table(
        'erp_po_line',
        sa.Column('company_code', sa.String(length=20), primary_key=True),
        sa.Column('po_line_key', sa.String(length=60), primary_key=True),
        sa.Column('po_code', sa.BigInteger(), nullable=False),
        sa.Column('po_number', sa.String(length=100), nullable=False),
        sa.Column('po_date', sa.Date(), nullable=False),
        sa.Column('line_status', sa.String(length=20), nullable=False),
        sa.Column('delivery_location', sa.String(length=200), nullable=True),
        sa.Column('delivery_site_kind', sa.String(length=30), nullable=True),
        sa.Column('supplier_code', sa.String(length=50), nullable=False),
        sa.Column('supplier_name', sa.String(length=300), nullable=True),
        sa.Column('icode', sa.String(length=50), nullable=True),
        sa.Column('item_description', sa.String(length=600), nullable=True),
        sa.Column('group_code', sa.String(length=200), nullable=True),
        sa.Column('hsn', sa.String(length=30), nullable=True),
        sa.Column('unit', sa.String(length=30), nullable=True),
        sa.Column('ordqty', sa.Numeric(14, 3), nullable=False, server_default='0'),
        sa.Column('rate', sa.Numeric(14, 4), nullable=False, server_default='0'),
        sa.Column('tax_percent', sa.Numeric(6, 2), nullable=True),
        sa.Column('line_netamt', sa.Numeric(16, 2), nullable=False, server_default='0'),
        sa.Column('rcqty', sa.Numeric(14, 3), nullable=False, server_default='0'),
        sa.Column('cnlqty', sa.Numeric(14, 3), nullable=False, server_default='0'),
        sa.Column('hdr_netamt', sa.Numeric(16, 2), nullable=False, server_default='0'),
        sa.Column('hdr_chgamt', sa.Numeric(16, 2), nullable=False, server_default='0'),
        sa.Column('erp_loaded_at', sa.DateTime(timezone=True), nullable=True),
        *_seen(),
    )
    op.create_index('ix_erp_po_line_po', 'erp_po_line', ['po_code'])
    op.create_index('ix_erp_po_line_supplier', 'erp_po_line', ['company_code', 'supplier_code'])
    op.create_table(
        'erp_vendor',
        sa.Column('company_code', sa.String(length=20), primary_key=True),
        sa.Column('vendor_code', sa.String(length=50), primary_key=True),
        sa.Column('name', sa.String(length=300), nullable=False),
        sa.Column('gstin', sa.String(length=30), nullable=True),
        sa.Column('city', sa.String(length=100), nullable=True),
        sa.Column('is_extinct', sa.Boolean(), nullable=False, server_default='false'),
        *_seen(),
    )
    op.create_table(
        'erp_item',
        sa.Column('icode', sa.String(length=50), primary_key=True),
        sa.Column('company_code', sa.String(length=20), nullable=False),
        sa.Column('article_name', sa.String(length=300), nullable=True),
        sa.Column('section', sa.String(length=200), nullable=True),
        sa.Column('department', sa.String(length=200), nullable=True),
        sa.Column('division', sa.String(length=100), nullable=True),
        sa.Column('cat1', sa.String(length=300), nullable=True),
        sa.Column('cat2', sa.String(length=300), nullable=True),
        sa.Column('cat3', sa.String(length=300), nullable=True),
        sa.Column('cat4', sa.String(length=300), nullable=True),
        sa.Column('cat5', sa.String(length=300), nullable=True),
        sa.Column('cat6', sa.String(length=300), nullable=True),
        sa.Column('hsn', sa.String(length=30), nullable=True),
        sa.Column('unit', sa.String(length=30), nullable=True),
        *_seen(),
    )


def downgrade() -> None:
    op.drop_table('erp_item')
    op.drop_table('erp_vendor')
    op.drop_index('ix_erp_po_line_supplier', table_name='erp_po_line')
    op.drop_index('ix_erp_po_line_po', table_name='erp_po_line')
    op.drop_table('erp_po_line')
    op.drop_table('erp_sync_run')
