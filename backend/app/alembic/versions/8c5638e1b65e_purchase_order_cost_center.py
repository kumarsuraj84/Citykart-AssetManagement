"""purchase order cost centre

Revision ID: 8c5638e1b65e
Revises: 9f973f6c81e9
Create Date: 2026-09-25 00:00:00.000000

Cost Centre moves from being picked per pending-asset line to a single
PO-header attribute (docs/ai/DECISIONS.md correction, 2026-09-25). Additive,
nullable column -- existing purchase_order rows created before this
migration keep no cost centre; add_pending_asset_line now refuses to add a
line to such a PO until one is set. pending_asset.cost_center_id is
unchanged: it still stores the value inherited from the parent PO at
line-creation time, since deliver_pending_assets/procure_assets need it per
line.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '8c5638e1b65e'
down_revision: Union[str, Sequence[str], None] = '9f973f6c81e9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('purchase_order', sa.Column('cost_center_id', sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        'fk_purchase_order_cost_center_id', 'purchase_order', 'cost_center', ['cost_center_id'], ['id'],
    )


def downgrade() -> None:
    op.drop_constraint('fk_purchase_order_cost_center_id', 'purchase_order', type_='foreignkey')
    op.drop_column('purchase_order', 'cost_center_id')
