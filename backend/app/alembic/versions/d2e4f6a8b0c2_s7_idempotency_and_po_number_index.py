"""S7 fix round (P1-2): idempotency_key table + one live PO number per company

Revision ID: d2e4f6a8b0c2
Revises: c1d3e5f7a9b0
Create Date: 2026-10-13 20:00:00.000000

1. `idempotency_key` (new, technical): one row per (user, Idempotency-Key header) of a create / receive /
   move request -- the request's hash, and once it succeeded its status code and JSON answer, so a repeat of
   the same request is answered from here instead of being done twice (app.core.idempotency). Rows older
   than 24 hours are removed by the application. UNIQUE(actor_id, key); index on created_at for that purge.

2. `uq_purchase_order_company_number_active` (new partial unique index): at most one LIVE purchase order per
   company and PO number as the application compares it (trimmed, any letter case):
   ON purchase_order (company_id, lower(btrim(po_number))) WHERE is_active.
   The index is only made when NO such duplicate exists already. If the database already holds duplicates
   (for example two live POs "UAT-D-TXZPT" from the S7 UAT double submit), the index is SKIPPED with a clear
   NOTICE / warning listing them, and nothing is rewritten or deleted -- the application's transaction-scoped
   advisory lock on (company, PO number) (app.purchase_orders.service.lock_po_number) still stops new
   duplicates. Deactivate the extra PO(s) and run `alembic downgrade -1 && alembic upgrade head` (or create
   the index by hand with the statement above) to add the index later.

Additive only: no existing table, column or row changes. Downgrade drops the index (if it was made) and the
new table.
"""
import logging
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'd2e4f6a8b0c2'
down_revision: Union[str, Sequence[str], None] = 'c1d3e5f7a9b0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

log = logging.getLogger("alembic.runtime.migration")

PO_INDEX = "uq_purchase_order_company_number_active"

DUPLICATES_SQL = """
    SELECT company_id, lower(btrim(po_number)) AS number, count(*) AS live_pos, string_agg(id::text, ', ' ORDER BY id) AS ids
    FROM purchase_order
    WHERE is_active
    GROUP BY company_id, lower(btrim(po_number))
    HAVING count(*) > 1
    ORDER BY company_id, 2
"""


def upgrade() -> None:
    op.create_table(
        'idempotency_key',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('key', sa.String(length=200), nullable=False),
        sa.Column('actor_id', sa.BigInteger(), nullable=False),
        sa.Column('method', sa.String(length=10), nullable=False),
        sa.Column('path', sa.String(length=500), nullable=False),
        sa.Column('request_hash', sa.String(length=64), nullable=False),
        sa.Column('status_code', sa.Integer(), nullable=True),
        sa.Column('response_json', postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['actor_id'], ['asset_user.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('actor_id', 'key', name='uq_idempotency_key_actor_key'),
    )
    op.create_index('ix_idempotency_key_created_at', 'idempotency_key', ['created_at'])

    bind = op.get_bind()
    duplicates = bind.execute(sa.text(DUPLICATES_SQL)).fetchall()
    if duplicates:
        listing = "; ".join(f"company {r.company_id}: '{r.number}' x{r.live_pos} (purchase_order ids {r.ids})"
                            for r in duplicates)
        message = (f"{PO_INDEX} NOT created: {len(duplicates)} PO number(s) are already used by more than one live "
                   f"purchase order in the same company ({listing}). Nothing was changed; new duplicates are still "
                   "refused by the application's advisory lock. Deactivate the extra PO(s), then re-run this migration "
                   "(downgrade -1, upgrade head) to add the index.")
        log.warning(message)
        safe = message.replace("'", "''").replace("%", " percent ")   # no % reaches RAISE's format string
        bind.exec_driver_sql(f"DO $$ BEGIN RAISE NOTICE '{safe}'; END $$;")
        return
    op.execute(
        f"CREATE UNIQUE INDEX {PO_INDEX} ON purchase_order (company_id, lower(btrim(po_number))) WHERE is_active"
    )


def downgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS {PO_INDEX}")
    op.drop_index('ix_idempotency_key_created_at', table_name='idempotency_key')
    op.drop_table('idempotency_key')
