"""Brands know which work areas (IT / Non-IT) they are used for

Revision ID: b3d5f7a9c1e4
Revises: a9c1e3b5d7f2
Create Date: 2026-11-12 15:00:00.000000

`brand.work_areas` is a list of work-area codes ('IT', 'NON_IT'). A brand can serve both (Samsung), so it stays one
row with one name and one code; pickers show only the brands whose list has the work area of the Item being used.

Additive and safe for existing data: no brand, code, name or Item link changes. Each existing brand is filled in from
where it is already used (the work area of the Items that default to it, of its assets and of its PO lines); a brand
that is used nowhere yet starts as BOTH areas, so nothing disappears from a list that has it today.
"""
from typing import Sequence, Union

from alembic import op

revision: str = 'b3d5f7a9c1e4'
down_revision: Union[str, Sequence[str], None] = 'a9c1e3b5d7f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Fills each brand that is used somewhere from that use; brands used nowhere keep the column default (both areas).
# A named constant so a test can run exactly this statement.
BACKFILL_SQL = """
UPDATE brand b SET work_areas = u.areas
FROM (
    SELECT brand_id, array_agg(DISTINCT area ORDER BY area)::varchar[] AS areas
    FROM (
        SELECT i.default_brand_id AS brand_id, c.asset_domain AS area
          FROM item i JOIN asset_category c ON c.id = i.category_id
         WHERE i.default_brand_id IS NOT NULL
        UNION ALL
        SELECT brand_id, asset_domain FROM asset WHERE brand_id IS NOT NULL
        UNION ALL
        SELECT brand_id, asset_domain FROM pending_asset WHERE brand_id IS NOT NULL AND asset_domain IS NOT NULL
    ) used
    WHERE area IN ('IT', 'NON_IT')
    GROUP BY brand_id
) u
WHERE u.brand_id = b.id
"""


def upgrade() -> None:
    op.execute("ALTER TABLE brand ADD COLUMN work_areas varchar(10)[] NOT NULL DEFAULT ARRAY['IT','NON_IT']::varchar[]")
    op.execute(BACKFILL_SQL)


def downgrade() -> None:
    op.execute("ALTER TABLE brand DROP COLUMN work_areas")
