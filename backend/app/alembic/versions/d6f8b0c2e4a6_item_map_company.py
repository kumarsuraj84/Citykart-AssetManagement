"""Item rules belong to a company's ERP master

Revision ID: d6f8b0c2e4a6
Revises: c5e7a9b1d3f5
Create Date: 2026-10-10 22:00:00.000000

Two companies have two ERP item masters: the same code or Article name can mean
different things in each, and the same product (a mic) has different codes,
Sections, Departments and Articles. A mapping rule now says which company's ERP
master it is for. NULL means "every company" (for two companies that share one
master); a company's own rule beats an every-company rule. Existing rules (none
in production) are tied to no company, i.e. every company.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd6f8b0c2e4a6'
down_revision: Union[str, Sequence[str], None] = 'c5e7a9b1d3f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('item_map', sa.Column('company_id', sa.BigInteger(), sa.ForeignKey('company.id'), nullable=True))
    op.execute("DROP INDEX IF EXISTS ux_item_map_code")
    op.execute("DROP INDEX IF EXISTS ux_item_map_article")
    op.execute("DROP INDEX IF EXISTS ux_item_map_name")
    op.execute("CREATE UNIQUE INDEX ux_item_map_code ON item_map (coalesce(company_id, 0), lower(erp_item_code)) WHERE is_active AND match_type = 'CODE'")
    op.execute("CREATE UNIQUE INDEX ux_item_map_article ON item_map (coalesce(company_id, 0), article_key) WHERE is_active AND match_type = 'ARTICLE'")
    op.execute("CREATE UNIQUE INDEX ux_item_map_name ON item_map (coalesce(company_id, 0), article_key, name_key) WHERE is_active AND match_type = 'NAME'")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ux_item_map_name")
    op.execute("DROP INDEX IF EXISTS ux_item_map_article")
    op.execute("DROP INDEX IF EXISTS ux_item_map_code")
    op.execute("CREATE UNIQUE INDEX ux_item_map_code ON item_map (lower(erp_item_code)) WHERE is_active AND match_type = 'CODE'")
    op.execute("CREATE UNIQUE INDEX ux_item_map_article ON item_map (article_key) WHERE is_active AND match_type = 'ARTICLE'")
    op.execute("CREATE UNIQUE INDEX ux_item_map_name ON item_map (article_key, name_key) WHERE is_active AND match_type = 'NAME'")
    op.drop_column('item_map', 'company_id')
