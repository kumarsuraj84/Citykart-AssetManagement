"""brand master

Revision ID: d4e9a2f8b1c3
Revises: c2a8f731d904
Create Date: 2026-09-29 12:00:00.000000

Brand becomes a real master (code + name, same shape as Category/Vendor/
Location) instead of a free-text field typed independently on every Asset
and every PO line -- requested so it can be centrally managed under
Setup > Masters (with its own Import/Export, matching every other master)
rather than drifting into inconsistent spellings across assets.

Data preservation: every distinct existing free-text value from BOTH
asset.brand and pending_asset.brand becomes exactly one new Brand row
(matched by exact trimmed text, so a value used on both an asset and a PO
line collapses onto the same row), with an auto-generated code derived
from the name (deduplicated). Every asset/pending_asset row is repointed
at its matching Brand via the new brand_id before the old free-text
columns are dropped -- no existing brand data is lost.
"""
import re
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd4e9a2f8b1c3'
down_revision: Union[str, Sequence[str], None] = 'c2a8f731d904'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _brand_code(name: str, used: set[str]) -> str:
    """Same 20-char varchar limit as every other master's `code` column --
    strip to bare alnum, truncate, then disambiguate with a numeric suffix
    on collision (two different free-text brand spellings that happen to
    normalize to the same code, e.g. "HP" vs "H.P.")."""
    base = re.sub(r"[^A-Z0-9]", "", name.upper())[:20] or "BRAND"
    code = base
    n = 2
    while code in used:
        suffix = str(n)
        code = base[: 20 - len(suffix)] + suffix
        n += 1
    used.add(code)
    return code


def upgrade() -> None:
    op.create_table(
        'brand',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('code', sa.String(length=20), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.BigInteger(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_by', sa.BigInteger(), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('code'),
    )

    op.add_column('asset', sa.Column('brand_id', sa.BigInteger(), nullable=True))
    op.create_foreign_key('fk_asset_brand_id_brand', 'asset', 'brand', ['brand_id'], ['id'])
    op.add_column('pending_asset', sa.Column('brand_id', sa.BigInteger(), nullable=True))
    op.create_foreign_key('fk_pending_asset_brand_id_brand', 'pending_asset', 'brand', ['brand_id'], ['id'])

    bind = op.get_bind()
    brand_table = sa.table(
        'brand', sa.column('id', sa.BigInteger), sa.column('code', sa.String), sa.column('name', sa.String),
    )

    asset_brands = bind.execute(sa.text(
        "SELECT DISTINCT btrim(brand) FROM asset WHERE brand IS NOT NULL AND btrim(brand) <> ''"
    )).scalars().all()
    pending_brands = bind.execute(sa.text(
        "SELECT DISTINCT btrim(brand) FROM pending_asset WHERE brand IS NOT NULL AND btrim(brand) <> ''"
    )).scalars().all()
    distinct_names = sorted({*asset_brands, *pending_brands})

    used_codes: set[str] = set()
    for name in distinct_names:
        code = _brand_code(name, used_codes)
        brand_id = bind.execute(
            brand_table.insert().values(code=code, name=name).returning(brand_table.c.id)
        ).scalar_one()
        bind.execute(
            sa.text("UPDATE asset SET brand_id = :bid WHERE btrim(brand) = :name"),
            {"bid": brand_id, "name": name},
        )
        bind.execute(
            sa.text("UPDATE pending_asset SET brand_id = :bid WHERE btrim(brand) = :name"),
            {"bid": brand_id, "name": name},
        )

    op.drop_column('asset', 'brand')
    op.drop_column('pending_asset', 'brand')


def downgrade() -> None:
    op.add_column('asset', sa.Column('brand', sa.String(length=200), nullable=True))
    op.add_column('pending_asset', sa.Column('brand', sa.String(length=200), nullable=True))

    bind = op.get_bind()
    bind.execute(sa.text("UPDATE asset SET brand = brand.name FROM brand WHERE asset.brand_id = brand.id"))
    bind.execute(sa.text(
        "UPDATE pending_asset SET brand = brand.name FROM brand WHERE pending_asset.brand_id = brand.id"
    ))

    op.drop_constraint('fk_pending_asset_brand_id_brand', 'pending_asset', type_='foreignkey')
    op.drop_column('pending_asset', 'brand_id')
    op.drop_constraint('fk_asset_brand_id_brand', 'asset', type_='foreignkey')
    op.drop_column('asset', 'brand_id')
    op.drop_table('brand')
