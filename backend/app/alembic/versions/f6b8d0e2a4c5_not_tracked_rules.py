"""ERP codes that CKAM does not track ("not tracked" rules, and Department / Section / Division levels)

Revision ID: f6b8d0e2a4c5
Revises: e5a7c9b1d3f4
Create Date: 2026-10-13 18:00:00.000000

The ERP's Fixed Assets division also holds shop-fitting material (cables, hangers, sensor tags, brackets)
that CKAM must not be cluttered with. An item_map rule may now say "not tracked" instead of pointing at an
Item (item_id becomes nullable, not_tracked marks it, and a check keeps one of the two set), and rules can
be made for a whole Department, Section or Division (level_key holds that level's ERP name). Additive for
existing rows: every existing rule keeps its Item and has not_tracked = false.
Downgrade removes not-tracked and level rules (they have no Item to go back to).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'f6b8d0e2a4c5'
down_revision: Union[str, Sequence[str], None] = 'e5a7c9b1d3f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('item_map', 'item_id', existing_type=sa.BigInteger(), nullable=True)
    op.add_column('item_map', sa.Column('not_tracked', sa.Boolean(), nullable=False, server_default='false'))
    op.add_column('item_map', sa.Column('level_key', sa.String(length=300), nullable=True))
    op.create_check_constraint('ck_item_map_item_or_not_tracked', 'item_map', 'item_id IS NOT NULL OR not_tracked')
    op.drop_constraint('ck_item_map_type', 'item_map', type_='check')
    op.create_check_constraint('ck_item_map_type', 'item_map',
                               "match_type IN ('CODE','NAME','ARTICLE','DEPARTMENT','SECTION','DIVISION')")
    # one rule per company and level name, like the Article / code / name rules
    op.execute("CREATE UNIQUE INDEX ux_item_map_level ON item_map (coalesce(company_id, 0), match_type, lower(level_key)) "
               "WHERE is_active AND match_type IN ('DEPARTMENT','SECTION','DIVISION')")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ux_item_map_level")
    op.execute("DELETE FROM item_map WHERE item_id IS NULL OR match_type IN ('DEPARTMENT', 'SECTION', 'DIVISION')")
    op.drop_constraint('ck_item_map_type', 'item_map', type_='check')
    op.create_check_constraint('ck_item_map_type', 'item_map', "match_type IN ('CODE','NAME','ARTICLE')")
    op.drop_constraint('ck_item_map_item_or_not_tracked', 'item_map', type_='check')
    op.drop_column('item_map', 'level_key')
    op.drop_column('item_map', 'not_tracked')
    op.alter_column('item_map', 'item_id', existing_type=sa.BigInteger(), nullable=False)
