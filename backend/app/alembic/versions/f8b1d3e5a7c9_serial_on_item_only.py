"""Serial rule lives on the Item only; bundle parts point at Items

Revision ID: f8b1d3e5a7c9
Revises: e7a0c2d4f6b8
Create Date: 2026-10-11 10:00:00.000000

Whether a thing carries a serial number is now decided by its Item alone (not by
its Category or Sub-Category). item.serial_required becomes a plain yes/no
(default yes); every existing Item first takes the answer it was effectively
giving (its own, else its sub-category's, else its category's), so nothing
changes by accident. The columns on asset_category / asset_subcategory are dropped.

bundle_part gets item_id: a Desktop's parts are the Items CPU, TFT, Keyboard,
Mouse. A part already in the database without one gets an Item made from it (or
the existing Item with that name in the same category), so no part is left
without an Item. category_id / subcategory_id stay on the part, filled from its Item.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'f8b1d3e5a7c9'
down_revision: Union[str, Sequence[str], None] = 'e7a0c2d4f6b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    # 1. Items keep the answer they were effectively giving.
    op.execute(
        "UPDATE item SET serial_required = COALESCE(item.serial_required, "
        "(SELECT s.serial_required FROM asset_subcategory s WHERE s.id = item.subcategory_id), "
        "(SELECT c.serial_required FROM asset_category c WHERE c.id = item.category_id), true)"
    )

    # 2. Parts get an Item.
    op.add_column('bundle_part', sa.Column('item_id', sa.BigInteger(), sa.ForeignKey('item.id'), nullable=True))
    parts = bind.execute(sa.text(
        "SELECT p.id, p.name, p.category_id, p.subcategory_id, "
        "COALESCE((SELECT s.serial_required FROM asset_subcategory s WHERE s.id = p.subcategory_id), "
        "(SELECT c.serial_required FROM asset_category c WHERE c.id = p.category_id), true) AS serial, "
        "(SELECT c.name FROM asset_category c WHERE c.id = p.category_id) AS category_name "
        "FROM bundle_part p WHERE p.item_id IS NULL ORDER BY p.id"
    )).all()
    for p in parts:
        found = bind.execute(sa.text(
            "SELECT id FROM item WHERE is_active AND lower(name) = lower(:n) AND category_id = :c AND bundle_id IS NULL LIMIT 1"
        ), {"n": p.name, "c": p.category_id}).scalar()
        if found is None:
            name = p.name
            taken = lambda n: bind.execute(sa.text("SELECT 1 FROM item WHERE is_active AND lower(name) = lower(:n)"), {"n": n}).first() is not None
            if taken(name):
                name = f"{p.name} ({p.category_name})"
            if taken(name):
                continue          # leave this part on its category; it still works
            found = bind.execute(sa.text(
                "INSERT INTO item (name, category_id, subcategory_id, serial_required) "
                "VALUES (:n, :c, :s, :r) RETURNING id"
            ), {"n": name, "c": p.category_id, "s": p.subcategory_id, "r": p.serial}).scalar()
        bind.execute(sa.text("UPDATE bundle_part SET item_id = :i WHERE id = :p"), {"i": found, "p": p.id})

    # 3. The Item's serial answer is now a plain yes/no.
    op.alter_column('item', 'serial_required', existing_type=sa.Boolean(), nullable=False, server_default=sa.text('true'))

    # 4. The category / sub-category levels no longer carry it.
    op.drop_column('asset_subcategory', 'serial_required')
    op.drop_column('asset_category', 'serial_required')


def downgrade() -> None:
    op.add_column('asset_category', sa.Column('serial_required', sa.Boolean(), nullable=False, server_default=sa.text('true')))
    op.add_column('asset_subcategory', sa.Column('serial_required', sa.Boolean(), nullable=True))
    op.alter_column('item', 'serial_required', existing_type=sa.Boolean(), nullable=True, server_default=None)
    op.drop_column('bundle_part', 'item_id')
