"""location company scope

Revision ID: f3b6c8a1d7e4
Revises: a1c7e5f3d9b2
Create Date: 2026-09-29 14:00:00.000000

Location becomes company-scoped (a real company_id column), matching
CostCenter's own shape -- previously it was a single global list shared by
every company, which meant the Holder form's Location picker (and the
IT_STOCK/INSTALLED coverage checklist) showed every company's locations
mixed together with no way to tell them apart.

Backfill for existing rows (no data loss, every row keeps its id/history):
1. Match each location to the company whose own `code` appears anywhere in
   the location's `code` (this codebase's own convention already prefixes
   location codes with the owning company's code, e.g. "CKSPLHO").
2. Any row that still doesn't match falls back to the company of a holder
   currently sitting at that location, if there is one.
3. Anything still unmatched after both passes is assigned to the earliest
   active company and deactivated, rather than left unassignable -- safer
   than guessing, and it was orphaned (no holder, no code match) already.
4. One specific known-duplicate row ("HO-CKSPL", superseded by "HO Stores"
   once it existed) is deactivated per an explicit product decision, not
   inferred.

The unique constraint moves from a bare `code` (globally unique) to
`(company_id, code)` (unique per company), same as CostCenter.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f3b6c8a1d7e4'
down_revision: Union[str, Sequence[str], None] = 'a1c7e5f3d9b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('location', sa.Column('company_id', sa.BigInteger(), nullable=True))
    op.create_foreign_key('fk_location_company_id_company', 'location', 'company', ['company_id'], ['id'])

    bind = op.get_bind()

    # Pass 1: location.code contains an active company's own code.
    companies = bind.execute(sa.text("SELECT id, code FROM company WHERE is_active = true")).all()
    for company_id, company_code in companies:
        bind.execute(
            sa.text("UPDATE location SET company_id = :cid WHERE company_id IS NULL AND code ILIKE '%' || :ccode || '%'"),
            {"cid": company_id, "ccode": company_code},
        )

    # Pass 2: fall back to a holder currently sitting at that location.
    bind.execute(sa.text("""
        UPDATE location SET company_id = h.company_id
        FROM (SELECT DISTINCT ON (location_id) location_id, company_id FROM holder ORDER BY location_id, id) h
        WHERE location.id = h.location_id AND location.company_id IS NULL
    """))

    # Pass 3: anything still unmatched -- orphaned (no code match, no
    # holder) -- goes to the earliest active company, deactivated rather
    # than guessed as a real, in-use row.
    fallback_company_id = bind.execute(sa.text("SELECT id FROM company WHERE is_active = true ORDER BY id LIMIT 1")).scalar()
    if fallback_company_id is not None:
        bind.execute(
            sa.text("UPDATE location SET company_id = :cid, is_active = false WHERE company_id IS NULL"),
            {"cid": fallback_company_id},
        )

    # One-off cleanup: "HO-CKSPL" was an early leftover, superseded by the
    # properly-coded "HO Stores" (CKSPLHO) -- deactivated per explicit
    # confirmation, not inferred from the pattern above.
    bind.execute(sa.text("UPDATE location SET is_active = false WHERE code = 'HO-CKSPL'"))

    op.alter_column('location', 'company_id', nullable=False)
    op.drop_constraint('location_code_key', 'location', type_='unique')
    op.create_unique_constraint('uq_location_company_id_code', 'location', ['company_id', 'code'])


def downgrade() -> None:
    op.drop_constraint('uq_location_company_id_code', 'location', type_='unique')
    op.create_unique_constraint('location_code_key', 'location', ['code'])
    op.drop_constraint('fk_location_company_id_company', 'location', type_='foreignkey')
    op.drop_column('location', 'company_id')
