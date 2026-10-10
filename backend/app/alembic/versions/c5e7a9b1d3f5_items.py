"""Items: CityKart's own item master, and which ERP codes belong to each

Revision ID: c5e7a9b1d3f5
Revises: b4d6f8a0c2e3
Create Date: 2026-10-10 20:00:00.000000

item = what an asset is ("Cassette AC"), pointing at the Category/Sub-Category
that already drive asset codes and reports. item_map says which Item an ERP item
code belongs to (by code, by product name inside an Article, or by whole
Article). pending_asset and asset remember their item_id and the ERP item code
they came from. item_catalog (the per-code "remember this item" memory, never
released) is replaced by this and dropped. Additive apart from that.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c5e7a9b1d3f5'
down_revision: Union[str, Sequence[str], None] = 'b4d6f8a0c2e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _audit_cols() -> list:
    return [
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('created_by', sa.BigInteger(), sa.ForeignKey('asset_user.id'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_by', sa.BigInteger(), sa.ForeignKey('asset_user.id'), nullable=True),
    ]


def _soft_cols() -> list:
    return [
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
    ]


def upgrade() -> None:
    op.drop_index('ux_item_catalog_code_ci', table_name='item_catalog')
    op.drop_table('item_catalog')

    op.create_table(
        'item',
        sa.Column('id', sa.BigInteger(), primary_key=True),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('category_id', sa.BigInteger(), sa.ForeignKey('asset_category.id'), nullable=False),
        sa.Column('subcategory_id', sa.BigInteger(), sa.ForeignKey('asset_subcategory.id'), nullable=True),
        sa.Column('serial_required', sa.Boolean(), nullable=True),
        sa.Column('bundle_id', sa.BigInteger(), sa.ForeignKey('bundle.id'), nullable=True),
        sa.Column('default_brand_id', sa.BigInteger(), sa.ForeignKey('brand.id'), nullable=True),
        sa.Column('default_warranty_years', sa.Integer(), nullable=True),
        *_audit_cols(), *_soft_cols(),
    )
    op.execute("CREATE UNIQUE INDEX ux_item_name_active_ci ON item (lower(name)) WHERE is_active")

    op.create_table(
        'item_map',
        sa.Column('id', sa.BigInteger(), primary_key=True),
        sa.Column('item_id', sa.BigInteger(), sa.ForeignKey('item.id'), nullable=False),
        sa.Column('match_type', sa.String(length=10), nullable=False),
        sa.Column('article_key', sa.String(length=300), nullable=True),
        sa.Column('name_key', sa.String(length=300), nullable=True),
        sa.Column('erp_item_code', sa.String(length=50), nullable=True),
        sa.Column('section', sa.String(length=200), nullable=True),
        sa.Column('department', sa.String(length=200), nullable=True),
        sa.Column('article_name', sa.String(length=300), nullable=True),
        sa.Column('note', sa.String(length=300), nullable=True),
        sa.CheckConstraint("match_type IN ('CODE','NAME','ARTICLE')", name='ck_item_map_type'),
        *_audit_cols(), *_soft_cols(),
    )
    op.execute("CREATE UNIQUE INDEX ux_item_map_code ON item_map (lower(erp_item_code)) WHERE is_active AND match_type = 'CODE'")
    op.execute("CREATE UNIQUE INDEX ux_item_map_article ON item_map (article_key) WHERE is_active AND match_type = 'ARTICLE'")
    op.execute("CREATE UNIQUE INDEX ux_item_map_name ON item_map (article_key, name_key) WHERE is_active AND match_type = 'NAME'")

    op.add_column('pending_asset', sa.Column('item_id', sa.BigInteger(), sa.ForeignKey('item.id'), nullable=True))
    op.add_column('pending_asset', sa.Column('erp_item_code', sa.String(length=50), nullable=True))
    op.add_column('asset', sa.Column('item_id', sa.BigInteger(), sa.ForeignKey('item.id'), nullable=True))
    op.add_column('asset', sa.Column('erp_item_code', sa.String(length=50), nullable=True))
    op.create_index('ix_asset_item_id', 'asset', ['item_id'])


def downgrade() -> None:
    op.drop_index('ix_asset_item_id', table_name='asset')
    op.drop_column('asset', 'erp_item_code')
    op.drop_column('asset', 'item_id')
    op.drop_column('pending_asset', 'erp_item_code')
    op.drop_column('pending_asset', 'item_id')
    op.execute("DROP INDEX IF EXISTS ux_item_map_name")
    op.execute("DROP INDEX IF EXISTS ux_item_map_article")
    op.execute("DROP INDEX IF EXISTS ux_item_map_code")
    op.drop_table('item_map')
    op.execute("DROP INDEX IF EXISTS ux_item_name_active_ci")
    op.drop_table('item')
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
        *_audit_cols(),
    )
    op.execute("CREATE UNIQUE INDEX ux_item_catalog_code_ci ON item_catalog (lower(item_code))")
