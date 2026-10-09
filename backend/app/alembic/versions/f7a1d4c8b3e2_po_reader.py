"""PO reader: a delivery location on purchase orders, and the item memory table

Revision ID: f7a1d4c8b3e2
Revises: e5b2c8a4d1f6
Create Date: 2026-10-10 10:00:00.000000

purchase_order gains two optional columns: delivery_asset_user_id (the stock
point the goods arrive at, which Mark Delivery Done pre-selects as the Initial
Asset User) and warehouse_code (the text it was derived from, e.g.
CKSPL-WH-TAJNAGAR, so the choice is remembered for the next PO from the same
warehouse). item_catalog remembers category/sub-category/brand/model/warranty
(or a bundle) per item code. Purely additive.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'f7a1d4c8b3e2'
down_revision: Union[str, Sequence[str], None] = 'e5b2c8a4d1f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('purchase_order', sa.Column('delivery_asset_user_id', sa.BigInteger(), sa.ForeignKey('asset_user.id'), nullable=True))
    op.add_column('purchase_order', sa.Column('warehouse_code', sa.String(length=100), nullable=True))

    op.create_table(
        'item_catalog',
        sa.Column('id', sa.BigInteger(), primary_key=True),
        sa.Column('item_code', sa.String(length=50), nullable=False),
        sa.Column('group_code', sa.String(length=50), nullable=True),
        sa.Column('category_id', sa.BigInteger(), sa.ForeignKey('asset_category.id'), nullable=True),
        sa.Column('subcategory_id', sa.BigInteger(), sa.ForeignKey('asset_subcategory.id'), nullable=True),
        sa.Column('brand_id', sa.BigInteger(), sa.ForeignKey('brand.id'), nullable=True),
        sa.Column('model', sa.String(length=200), nullable=True),
        sa.Column('warranty_years', sa.Integer(), nullable=True),
        sa.Column('bundle_id', sa.BigInteger(), sa.ForeignKey('bundle.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('created_by', sa.BigInteger(), sa.ForeignKey('asset_user.id'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_by', sa.BigInteger(), sa.ForeignKey('asset_user.id'), nullable=True),
    )
    op.execute("CREATE UNIQUE INDEX ux_item_catalog_code_ci ON item_catalog (lower(item_code))")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ux_item_catalog_code_ci")
    op.drop_table('item_catalog')
    op.drop_column('purchase_order', 'warehouse_code')
    op.drop_column('purchase_order', 'delivery_asset_user_id')
