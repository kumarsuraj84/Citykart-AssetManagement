"""PO lines get a number: pending_asset.line_no

Revision ID: b8d0f2a4c6e8
Revises: f6b8d0e2a4c5
Create Date: 2026-10-13 10:00:00.000000

S2.4 (simplification programme): a purchase order is stored one row per unit
(quantity 5 = 5 pending_asset rows). The PO screen shows LINES ("5 laptops,
3 received, 2 waiting"), so every unit now carries the number of the line it
was ordered on, 1..n within its purchase order. Two lines that happen to look
identical stay two lines.

Additive only: one nullable integer column and an index on
(purchase_order_id, line_no). Nothing else about any row changes.

Backfill (deterministic): per purchase order, the existing units are grouped by
what a line was entered with -- item_id, erp_item_code, description, barcode,
category_id, subcategory_id, brand_id, model, warranty_years, purchase_cost,
tax_percent, bundle_label (NULLs equal) -- and the groups are numbered 1..n in
the order of the smallest unit id of each group. Delivered and cancelled units
are numbered too (they belong to a line like any other unit).

Downgrade drops the index and the column (the numbers are recomputable).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b8d0f2a4c6e8'
down_revision: Union[str, Sequence[str], None] = 'f6b8d0e2a4c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NATURAL_KEY = (
    "item_id, erp_item_code, description, barcode, category_id, subcategory_id, brand_id, "
    "model, warranty_years, purchase_cost, tax_percent, bundle_label"
)

# Window partitions treat NULLs as equal, so two units that both have no
# model (say) belong to the same line. Kept as a constant so a regression
# test can run exactly this statement.
BACKFILL_SQL = f"""
    UPDATE pending_asset AS p
    SET line_no = numbered.line_no
    FROM (
        SELECT id,
               DENSE_RANK() OVER (PARTITION BY purchase_order_id ORDER BY first_id) AS line_no
        FROM (
            SELECT id, purchase_order_id,
                   MIN(id) OVER (PARTITION BY purchase_order_id, {NATURAL_KEY}) AS first_id
            FROM pending_asset
        ) AS grouped
    ) AS numbered
    WHERE p.id = numbered.id
"""


def upgrade() -> None:
    op.add_column('pending_asset', sa.Column('line_no', sa.Integer(), nullable=True))
    op.create_index('ix_pending_asset_po_line_no', 'pending_asset', ['purchase_order_id', 'line_no'])
    op.execute(BACKFILL_SQL)


def downgrade() -> None:
    op.drop_index('ix_pending_asset_po_line_no', table_name='pending_asset')
    op.drop_column('pending_asset', 'line_no')
