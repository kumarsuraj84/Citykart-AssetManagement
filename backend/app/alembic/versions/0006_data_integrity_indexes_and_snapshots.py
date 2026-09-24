"""AM-01: hot-path indexes + historical event name snapshots

Revision ID: d2bcc801fcc1
Revises: 83d063397a4a
Create Date: 2026-09-24 00:00:00.000000

Purely additive -- no column type changes, no drops, no data rewriting.
See docs/ai/AM-01_DATA_INTEGRITY_REPORT.md for the full evidence trail
(actual query predicates inspected before choosing these indexes) and the
reasoning for what was deliberately NOT added (a full company/status/
category/holder composite, blanket CHECK/ENUM conversion, location/company/
cost-centre snapshots).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd2bcc801fcc1'
down_revision: Union[str, Sequence[str], None] = '83d063397a4a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # --- Historical event display snapshots -----------------------------
    # Nullable, additive columns. Existing rows stay NULL (no fabricated
    # backfill); app/lifecycle/service.py::apply_event populates them for
    # every new event going forward. Display code (lifecycle/router.py::
    # _with_labels, reports/router.py::export_movements) prefers the
    # snapshot and falls back to a live holder-name join only for the NULL
    # (pre-migration) rows.
    op.add_column("asset_event", sa.Column("from_holder_name_snapshot", sa.String(length=200), nullable=True))
    op.add_column("asset_event", sa.Column("to_holder_name_snapshot", sa.String(length=200), nullable=True))

    # --- asset: independent partial indexes, not one big composite ------
    # search_assets/dashboard_data apply status/category_id/current_holder_id/
    # company_id as INDEPENDENT, OPTIONAL filters (any subset may be active in
    # a given request), and ADMIN's cross-company queries often have NO
    # company_id filter at all (scoped_company_ids returns None for ADMIN) --
    # so a single composite anchored on company_id would not help an
    # ADMIN's company-unscoped status/category search. Four single-column
    # partial indexes let Postgres's bitmap index scan combine whichever
    # filters are actually present in each real query shape, instead of
    # only helping the one combination a composite's column order favors.
    # All four are partial (WHERE deleted_at IS NULL) because every list/
    # dashboard query already filters out soft-deleted assets first --
    # indexing rows that can never be returned would be pure waste.
    op.execute("""
        CREATE INDEX ix_asset_status_active
        ON asset (status)
        WHERE deleted_at IS NULL;
    """)
    op.execute("""
        CREATE INDEX ix_asset_current_holder_id_active
        ON asset (current_holder_id)
        WHERE deleted_at IS NULL;
    """)
    op.execute("""
        CREATE INDEX ix_asset_company_id_active
        ON asset (company_id)
        WHERE deleted_at IS NULL;
    """)
    op.execute("""
        CREATE INDEX ix_asset_category_id_active
        ON asset (category_id)
        WHERE deleted_at IS NULL;
    """)

    # --- asset_event: one justified composite + one single-column -------
    # (asset_id, event_date, id) directly matches the two asset-scoped, high-
    # frequency queries: lifecycle/router.py::list_events orders by
    # (event_date, id) ascending, and lifecycle/service.py::apply_event's own
    # "find the last event for this asset" lookup -- which runs on EVERY
    # single lifecycle transition -- orders by (event_date DESC, id DESC). A
    # btree index is scannable in either direction, so one composite serves
    # both; id is included to match the exact tie-break both queries use.
    op.execute("""
        CREATE INDEX ix_asset_event_asset_id_event_date
        ON asset_event (asset_id, event_date, id);
    """)
    # event_date alone: reports/router.py::export_movements filters by a
    # date range WITHOUT a single asset_id (it's a whole-company movement
    # log), so it can't use the composite above -- it needs event_date as a
    # leading column instead. Lower frequency than the composite's two
    # queries (a manual staff report download, not a per-request hot path),
    # but still a real, evidenced predicate, and was explicitly named in the
    # AM-01 authorization's "at minimum" list.
    op.execute("""
        CREATE INDEX ix_asset_event_event_date
        ON asset_event (event_date);
    """)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DROP INDEX IF EXISTS ix_asset_event_event_date;")
    op.execute("DROP INDEX IF EXISTS ix_asset_event_asset_id_event_date;")
    op.execute("DROP INDEX IF EXISTS ix_asset_category_id_active;")
    op.execute("DROP INDEX IF EXISTS ix_asset_company_id_active;")
    op.execute("DROP INDEX IF EXISTS ix_asset_current_holder_id_active;")
    op.execute("DROP INDEX IF EXISTS ix_asset_status_active;")
    op.drop_column("asset_event", "to_holder_name_snapshot")
    op.drop_column("asset_event", "from_holder_name_snapshot")
