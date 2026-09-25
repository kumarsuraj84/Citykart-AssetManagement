# Purchase Order / Pending Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second, optional asset-entry path — raise a Purchase Order,
add pending line items (no serial/invoice yet), then mark delivery done
per-PO to supply Invoice No/Date/Amount once and Serial Number/Initial
Holder per unit, converting each into a real, numbered Asset through the
existing creation logic. Add Asset itself is untouched.

**Architecture:** Two new additive tables (`purchase_order`,
`pending_asset`) in a new `app/purchase_orders/` backend module, following
the existing per-domain module layout (`models.py`/`schemas.py`/
`service.py`/`router.py`). Conversion reuses
`app.assets.service.procure_assets` unchanged — no parallel numbering or
ledger-writing logic. Frontend adds three new routes/screens
(`/purchase-orders`, `/purchase-orders/new`, `/purchase-orders/$id`)
under a new `features/purchase-orders/` directory, following the same
shared-component conventions (`PageHeader`/`DataTable`/`StatusBadge`/
`AsyncButton`/`Dialog`) every existing screen already uses.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async + PostgreSQL 17 (backend);
React 19 + Vite + TanStack Query/Router + Tailwind + shadcn/ui (frontend).
No new dependency.

**Spec:** `docs/specs/2026-09-25-po-pending-assets-design.md`

## Global Constraints

- Money math is always `Decimal(str(x))`, never a bare float — mirror
  `app/assets/service.py::compute_tax` exactly; reuse it, don't
  reimplement it.
- No hard deletes anywhere — a cancelled `PendingAsset` line is
  soft-stated (`status = "CANCELLED"`), never removed.
- Company scoping is mandatory on every read/write —
  `scoped_company_ids(holder)` / `ensure_company_in_scope(holder,
  company_id)` from `app.core.deps`, same as every existing module.
- Backend authorization is authoritative — every write endpoint uses
  `Depends(require_role("ADMIN", "IT_TEAM"))` (the plan's default per the
  spec's still-open role question); never rely on the frontend hiding a
  button.
- No schema change without an Alembic migration; write the downgrade
  path too.
- Conventional Commit messages; commit locally; do not push.
- Backend tests run against `ckam_test` only:
  `docker compose exec -T -e DATABASE_URL=postgresql+asyncpg://ckam:ckam_dev_pw@db:5432/ckam_test api python -m pytest -q`.
  Frontend: `npx tsc -b && npx vitest run` in `frontend/`. Rebuild the
  relevant container (`docker compose up -d --build api|web`) before any
  browser-based check — containers do not live-mount source.
- Reuse existing shared components (`PageHeader`, `DataTable`,
  `StatusBadge`, `EmptyState`, `ErrorState`, `AsyncButton`, `FormField`,
  the shadcn `Dialog`/`Select`) — never build a new one-off primitive for
  something these already do.
- Starting baseline to preserve throughout: Backend 312/312, Frontend
  154/154, TypeScript clean, E2E 5/5, Alembic head `f28b6a913dce`.

---

## Task 1: Backend data model + migration

**Files:**
- Create: `backend/app/purchase_orders/__init__.py` (empty)
- Create: `backend/app/purchase_orders/models.py`
- Create: `backend/app/alembic/versions/<new_revision>_purchase_orders_and_pending_assets.py`
- Test: `backend/tests/purchase_orders/__init__.py` (empty)
- Test: `backend/tests/purchase_orders/test_models.py`

**Interfaces:**
- Produces: `PurchaseOrder` (table `purchase_order`), `PendingAsset`
  (table `pending_asset`), `PENDING_ASSET_STATUSES = ("PENDING",
  "DELIVERED", "CANCELLED")` — all three imported by every later task.

- [ ] **Step 1: Write `models.py`**

```python
from datetime import date, datetime
from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base
from app.core.models import AuditMixin, SoftDeleteMixin

PENDING_ASSET_STATUSES = ("PENDING", "DELIVERED", "CANCELLED")


class PurchaseOrder(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "purchase_order"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("company.id"))
    po_number: Mapped[str] = mapped_column(String(100))
    po_date: Mapped[date] = mapped_column(Date)
    vendor_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("vendor.id"))


class PendingAsset(Base, AuditMixin):
    """One row per physical unit ordered under a PurchaseOrder. Not an
    Asset -- never appears in the Asset Register/Dashboard/exports.
    Converts into a real Asset (via app.assets.service.procure_assets,
    unchanged) at Delivery Done; this row is then frozen and kept as the
    traceability record (delivered_asset_id), never deleted."""
    __tablename__ = "pending_asset"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    purchase_order_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("purchase_order.id"))
    company_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("company.id"))
    description: Mapped[str] = mapped_column(String(500))
    category_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("asset_category.id"))
    subcategory_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("asset_subcategory.id"))
    cost_center_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("cost_center.id"))
    purchase_cost: Mapped[float | None] = mapped_column(Numeric(14, 2))
    tax_percent: Mapped[float | None] = mapped_column(Numeric(5, 2))
    tax_amount: Mapped[float | None] = mapped_column(Numeric(14, 2))
    total_cost: Mapped[float | None] = mapped_column(Numeric(14, 2))

    status: Mapped[str] = mapped_column(String(20), default="PENDING")

    serial_number: Mapped[str | None] = mapped_column(String(200))
    invoice_number: Mapped[str | None] = mapped_column(String(100))
    invoice_date: Mapped[date | None] = mapped_column(Date)
    invoice_amount: Mapped[float | None] = mapped_column(Numeric(14, 2))
    initial_holder_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("holder.id"))

    delivered_asset_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("asset.id"))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("holder.id"))
```

- [ ] **Step 2: Generate and hand-write the migration**

Run inside the `api` container to get the current head for `down_revision`:

```bash
docker compose exec -T api alembic heads
```

Expected output: `f28b6a913dce (head)`. Write the migration file with a
fresh revision id (any unique 12-hex-char string, e.g. generate one with
`python -c "import uuid; print(uuid.uuid4().hex[:12])"`):

```python
"""purchase orders and pending assets

Revision ID: <new_revision>
Revises: f28b6a913dce
Create Date: 2026-09-25 00:00:00.000000

New, additive-only tables for the PO / pre-delivery staging workflow
(docs/specs/2026-09-25-po-pending-assets-design.md). No existing table
changes. A PendingAsset converts into a real Asset via the existing
app.assets.service.procure_assets path -- this migration adds no new
ledger or numbering logic, just the staging tables themselves.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '<new_revision>'
down_revision: Union[str, Sequence[str], None] = 'f28b6a913dce'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'purchase_order',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.BigInteger(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_by', sa.BigInteger(), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default='true', nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('company_id', sa.BigInteger(), nullable=False),
        sa.Column('po_number', sa.String(length=100), nullable=False),
        sa.Column('po_date', sa.Date(), nullable=False),
        sa.Column('vendor_id', sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(['company_id'], ['company.id']),
        sa.ForeignKeyConstraint(['vendor_id'], ['vendor.id']),
        sa.ForeignKeyConstraint(['created_by'], ['holder.id']),
        sa.ForeignKeyConstraint(['updated_by'], ['holder.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_purchase_order_company_id', 'purchase_order', ['company_id'])

    op.create_table(
        'pending_asset',
        sa.Column('id', sa.BigInteger(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_by', sa.BigInteger(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_by', sa.BigInteger(), nullable=True),
        sa.Column('purchase_order_id', sa.BigInteger(), nullable=False),
        sa.Column('company_id', sa.BigInteger(), nullable=False),
        sa.Column('description', sa.String(length=500), nullable=False),
        sa.Column('category_id', sa.BigInteger(), nullable=False),
        sa.Column('subcategory_id', sa.BigInteger(), nullable=True),
        sa.Column('cost_center_id', sa.BigInteger(), nullable=False),
        sa.Column('purchase_cost', sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column('tax_percent', sa.Numeric(precision=5, scale=2), nullable=True),
        sa.Column('tax_amount', sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column('total_cost', sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='PENDING'),
        sa.Column('serial_number', sa.String(length=200), nullable=True),
        sa.Column('invoice_number', sa.String(length=100), nullable=True),
        sa.Column('invoice_date', sa.Date(), nullable=True),
        sa.Column('invoice_amount', sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column('initial_holder_id', sa.BigInteger(), nullable=True),
        sa.Column('delivered_asset_id', sa.BigInteger(), nullable=True),
        sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('delivered_by', sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(['purchase_order_id'], ['purchase_order.id']),
        sa.ForeignKeyConstraint(['company_id'], ['company.id']),
        sa.ForeignKeyConstraint(['category_id'], ['asset_category.id']),
        sa.ForeignKeyConstraint(['subcategory_id'], ['asset_subcategory.id']),
        sa.ForeignKeyConstraint(['cost_center_id'], ['cost_center.id']),
        sa.ForeignKeyConstraint(['initial_holder_id'], ['holder.id']),
        sa.ForeignKeyConstraint(['delivered_asset_id'], ['asset.id']),
        sa.ForeignKeyConstraint(['delivered_by'], ['holder.id']),
        sa.ForeignKeyConstraint(['created_by'], ['holder.id']),
        sa.ForeignKeyConstraint(['updated_by'], ['holder.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_pending_asset_purchase_order_id', 'pending_asset', ['purchase_order_id'])
    op.create_index('ix_pending_asset_company_id_status', 'pending_asset', ['company_id', 'status'])


def downgrade() -> None:
    op.drop_index('ix_pending_asset_company_id_status', table_name='pending_asset')
    op.drop_index('ix_pending_asset_purchase_order_id', table_name='pending_asset')
    op.drop_table('pending_asset')
    op.drop_index('ix_purchase_order_company_id', table_name='purchase_order')
    op.drop_table('purchase_order')
```

`ix_pending_asset_company_id_status` is added up front (not deferred
pending "query evidence," per this project's own usual discipline)
because the PO detail screen's own primary query — "this company's
PENDING lines" — is exactly this composite, mirroring why
`ix_asset_status_active`-style composite indexes already exist elsewhere
in this schema for the same reason.

- [ ] **Step 3: Apply the migration to `ckam_test` and verify**

```bash
docker compose exec -T -e DATABASE_URL=postgresql+asyncpg://ckam:ckam_dev_pw@db:5432/ckam_test api alembic upgrade head
docker compose exec -T -e DATABASE_URL=postgresql+asyncpg://ckam:ckam_dev_pw@db:5432/ckam_test api alembic current
```
Expected: reports the new revision id as `(head)`.

- [ ] **Step 4: Write `test_models.py`**

```python
from datetime import date
from app.core.db import SessionLocal
from app.masters.models import Company, AssetCategory
from app.purchase_orders.models import PurchaseOrder, PendingAsset


async def test_purchase_order_and_pending_asset_round_trip():
    async with SessionLocal() as session:
        co = Company(code="PO-MODEL-1", name="PO Model Test Co")
        cat = AssetCategory(code="PO-MODEL-1", name="IT")
        session.add_all([co, cat])
        await session.flush()

        po = PurchaseOrder(company_id=co.id, po_number="PO-TEST-1", po_date=date(2026, 1, 1))
        session.add(po)
        await session.flush()

        line = PendingAsset(
            purchase_order_id=po.id, company_id=co.id, description="Test Laptop",
            category_id=cat.id, cost_center_id=1, status="PENDING",
        )
        session.add(line)
        await session.commit()

        assert line.id is not None
        assert line.status == "PENDING"
        assert line.delivered_asset_id is None
```

(`cost_center_id=1` is a placeholder FK value for this narrow model-only
test; if the referential-integrity check fails because no cost centre
with id 1 exists in a fresh `ckam_test` run, create a real `CostCenter`
row in the fixture instead — mirror the pattern in
`backend/tests/assets/test_search.py`'s own setup.)

- [ ] **Step 5: Run the test, confirm pass, commit**

```bash
docker compose up -d --build api
docker compose exec -T -e DATABASE_URL=postgresql+asyncpg://ckam:ckam_dev_pw@db:5432/ckam_test api python -m pytest tests/purchase_orders/ -q
git add backend/app/purchase_orders backend/app/alembic/versions backend/tests/purchase_orders
git commit -m "feat(purchase-orders): PO/PendingAsset data model + migration"
```

---

## Task 2: Backend schemas + PO/line service layer (create, add line, edit, cancel)

**Files:**
- Create: `backend/app/purchase_orders/schemas.py`
- Create: `backend/app/purchase_orders/service.py`
- Test: `backend/tests/purchase_orders/test_service.py`

**Interfaces:**
- Consumes: `PurchaseOrder`, `PendingAsset`, `PENDING_ASSET_STATUSES`
  from Task 1; `compute_tax` from `app.assets.service`.
- Produces: `create_purchase_order`, `add_pending_asset_line`,
  `update_pending_asset_line`, `cancel_pending_asset_line` — all consumed
  by Task 4's router.

- [ ] **Step 1: Write `schemas.py`**

```python
from datetime import date
from pydantic import BaseModel, ConfigDict


class PurchaseOrderCreateIn(BaseModel):
    company_id: int
    po_number: str
    po_date: date
    vendor_id: int | None = None


class PurchaseOrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    po_number: str
    po_date: date
    vendor_id: int | None
    is_active: bool


class PendingAssetLineIn(BaseModel):
    description: str
    category_id: int
    subcategory_id: int | None = None
    cost_center_id: int
    purchase_cost: float | None = None
    tax_percent: float | None = None
    quantity: int = 1


class PendingAssetLineUpdateIn(BaseModel):
    description: str
    category_id: int
    subcategory_id: int | None = None
    cost_center_id: int
    purchase_cost: float | None = None
    tax_percent: float | None = None


class PendingAssetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    purchase_order_id: int
    company_id: int
    description: str
    category_id: int
    subcategory_id: int | None
    cost_center_id: int
    purchase_cost: float | None
    tax_percent: float | None
    tax_amount: float | None
    total_cost: float | None
    status: str
    serial_number: str | None
    invoice_number: str | None
    invoice_date: date | None
    invoice_amount: float | None
    initial_holder_id: int | None
    delivered_asset_id: int | None
```

- [ ] **Step 2: Write `service.py` — PO and line management (not delivery yet)**

```python
from app.core.db import AsyncSession
from app.holders.models import Holder
from app.masters.models import AssetCategory, AssetSubcategory, CostCenter
from app.assets.service import compute_tax
from app.purchase_orders.models import PurchaseOrder, PendingAsset


async def create_purchase_order(session: AsyncSession, data: dict, actor: Holder) -> PurchaseOrder:
    po = PurchaseOrder(
        company_id=data["company_id"], po_number=data["po_number"],
        po_date=data["po_date"], vendor_id=data.get("vendor_id"),
        created_by=actor.id, updated_by=actor.id,
    )
    session.add(po)
    await session.flush()
    return po


async def _validate_line_masters(session: AsyncSession, company_id: int, data: dict) -> None:
    """Same referential checks procure_assets already does for category/
    subcategory/cost-centre -- duplicated narrowly here (not imported)
    because procure_assets validates a *complete* asset-creation payload
    (also requiring purchase_date/initial_holder_id, neither of which
    exist yet at PO-entry time); this is the PO-entry-time subset only."""
    category = await session.get(AssetCategory, data["category_id"])
    if category is None:
        raise ValueError(f"category {data['category_id']} not found")
    subcategory_id = data.get("subcategory_id")
    if subcategory_id is not None:
        subcategory = await session.get(AssetSubcategory, subcategory_id)
        if subcategory is None:
            raise ValueError(f"subcategory {subcategory_id} not found")
        if subcategory.category_id != category.id:
            raise ValueError("sub-category does not belong to the selected category")
    cost_center = await session.get(CostCenter, data["cost_center_id"])
    if cost_center is None:
        raise ValueError(f"cost center {data['cost_center_id']} not found")
    if cost_center.company_id != company_id:
        raise ValueError("cost center must belong to the same company as the purchase order")


async def add_pending_asset_line(
    session: AsyncSession, purchase_order: PurchaseOrder, data: dict, actor: Holder,
) -> list[PendingAsset]:
    """quantity>1 creates that many separate PendingAsset rows (each will get
    its own distinct serial number at Delivery Done) -- mirrors
    procure_assets' own quantity handling, never one row with a count."""
    await _validate_line_masters(session, purchase_order.company_id, data)
    purchase_cost = data.get("purchase_cost")
    tax_percent = data.get("tax_percent")
    tax_amount, total_cost = compute_tax(purchase_cost, tax_percent)

    quantity = data.get("quantity", 1)
    created: list[PendingAsset] = []
    for _ in range(quantity):
        line = PendingAsset(
            purchase_order_id=purchase_order.id, company_id=purchase_order.company_id,
            description=data["description"], category_id=data["category_id"],
            subcategory_id=data.get("subcategory_id"), cost_center_id=data["cost_center_id"],
            purchase_cost=purchase_cost, tax_percent=tax_percent,
            tax_amount=tax_amount, total_cost=total_cost, status="PENDING",
            created_by=actor.id, updated_by=actor.id,
        )
        session.add(line)
        created.append(line)
    await session.flush()
    return created


async def update_pending_asset_line(session: AsyncSession, line: PendingAsset, data: dict, actor: Holder) -> PendingAsset:
    if line.status != "PENDING":
        raise ValueError(f"cannot edit a {line.status.lower()} line")
    await _validate_line_masters(session, line.company_id, data)
    tax_amount, total_cost = compute_tax(data.get("purchase_cost"), data.get("tax_percent"))
    line.description = data["description"]
    line.category_id = data["category_id"]
    line.subcategory_id = data.get("subcategory_id")
    line.cost_center_id = data["cost_center_id"]
    line.purchase_cost = data.get("purchase_cost")
    line.tax_percent = data.get("tax_percent")
    line.tax_amount = tax_amount
    line.total_cost = total_cost
    line.updated_by = actor.id
    await session.flush()
    return line


async def cancel_pending_asset_line(session: AsyncSession, line: PendingAsset, actor: Holder) -> PendingAsset:
    if line.status != "PENDING":
        raise ValueError(f"cannot cancel a {line.status.lower()} line")
    line.status = "CANCELLED"
    line.updated_by = actor.id
    await session.flush()
    return line
```

- [ ] **Step 3: Write `test_service.py`**

Cover, mirroring `backend/tests/assets/test_service.py`'s own fixture
style (a full company/cost-centre/category/subcategory/holder setup per
test):

1. `test_add_pending_asset_line_with_quantity_creates_that_many_rows` —
   `quantity=3` produces 3 distinct `PendingAsset` rows, each `PENDING`,
   each with the same computed `tax_amount`/`total_cost`.
2. `test_add_pending_asset_line_rejects_cost_centre_from_another_company`
   — a cross-company cost centre raises `ValueError`.
3. `test_update_pending_asset_line_recomputes_tax` — editing
   `purchase_cost`/`tax_percent` updates `tax_amount`/`total_cost`.
4. `test_update_pending_asset_line_rejects_a_non_pending_line` — a
   `CANCELLED` or `DELIVERED` line raises `ValueError` on edit attempt.
5. `test_cancel_pending_asset_line_sets_cancelled_and_is_terminal` —
   cancelling twice raises `ValueError` the second time.

- [ ] **Step 4: Run tests, confirm pass, commit**

```bash
docker compose up -d --build api
docker compose exec -T -e DATABASE_URL=postgresql+asyncpg://ckam:ckam_dev_pw@db:5432/ckam_test api python -m pytest tests/purchase_orders/ -q
git add backend/app/purchase_orders/schemas.py backend/app/purchase_orders/service.py backend/tests/purchase_orders/test_service.py
git commit -m "feat(purchase-orders): PO/line create, edit, cancel service layer"
```

---

## Task 3: Backend service layer — Delivery Done conversion

**Files:**
- Modify: `backend/app/purchase_orders/service.py`
- Modify: `backend/app/purchase_orders/schemas.py`
- Test: `backend/tests/purchase_orders/test_delivery.py`

**Interfaces:**
- Consumes: `procure_assets` from `app.assets.service` (unchanged,
  `quantity=1` per call — one `PendingAsset` is already one physical
  unit).
- Produces: `deliver_pending_assets(session, lines, deliveries, po_number,
  po_date, invoice_number, invoice_date, invoice_amount, actor) ->
  list[PendingAsset]`, consumed by Task 4's router.

- [ ] **Step 1: Add to `schemas.py`**

```python
class DeliveryLineIn(BaseModel):
    pending_asset_id: int
    serial_number: str
    initial_holder_id: int


class DeliveryDoneIn(BaseModel):
    invoice_number: str
    invoice_date: date
    invoice_amount: float
    lines: list[DeliveryLineIn]
```

- [ ] **Step 2: Add `deliver_pending_assets` to `service.py`**

```python
from app.assets.service import procure_assets


async def deliver_pending_assets(
    session: AsyncSession, lines: list[PendingAsset], deliveries: dict[int, dict],
    po_number: str, po_date, invoice_number: str, invoice_date, invoice_amount: float, actor: Holder,
) -> list[PendingAsset]:
    """One procure_assets(..., quantity=1, ...) call per line -- each
    PendingAsset already represents exactly one physical unit with its own
    serial number, so quantity is always 1 here (never batched), unlike
    Add Asset's own "buying 20 identical mice" quantity case. purchase_date
    is set to invoice_date: the PO design's own point that the two are the
    same thing in this flow, since there is no earlier date to use.
    po_number/po_date come from the parent PurchaseOrder (the caller's
    job to supply, since PendingAsset itself doesn't duplicate them) so
    the resulting Asset's own existing po_number/po_date columns
    (Add Asset already has and uses these) are populated too, not left
    null despite the whole point of this flow being PO-tracked
    procurement.

    Each line is delivered inside its own savepoint (nested transaction),
    matching procure_assets' quantity>1 caller pattern in app/imports --
    one line's failure must not corrupt or partially commit any other
    already-succeeded line in the same batch."""
    delivered: list[PendingAsset] = []
    for line in lines:
        if line.status != "PENDING":
            raise ValueError(f"pending asset {line.id} is not PENDING (already {line.status})")
        delivery = deliveries[line.id]
        async with session.begin_nested():
            [asset] = await procure_assets(
                session,
                {
                    "company_id": line.company_id, "cost_center_id": line.cost_center_id,
                    "category_id": line.category_id, "subcategory_id": line.subcategory_id,
                    "description": line.description, "purchase_cost": line.purchase_cost,
                    "tax_percent": line.tax_percent, "purchase_date": invoice_date,
                    "serial_number": delivery["serial_number"],
                    "initial_holder_id": delivery["initial_holder_id"],
                    "po_number": po_number, "po_date": po_date,
                    "invoice_number": invoice_number, "invoice_date": invoice_date,
                },
                quantity=1, actor=actor,
            )
            line.status = "DELIVERED"
            line.serial_number = delivery["serial_number"]
            line.initial_holder_id = delivery["initial_holder_id"]
            line.invoice_number = invoice_number
            line.invoice_date = invoice_date
            line.invoice_amount = invoice_amount
            line.delivered_asset_id = asset.id
            line.delivered_at = datetime.now(timezone.utc)
            line.delivered_by = actor.id
        delivered.append(line)
    await session.flush()
    return delivered
```

Add `from datetime import datetime, timezone` to the top of
`service.py` alongside the existing imports.

- [ ] **Step 3: Write `test_delivery.py`**

Mirror `backend/tests/assets/test_search.py`'s fixture style (full
company/cost-centre/category/subcategory/`IT_STOCK` holder/`CodeRule`
setup, an ADMIN actor). Cover:

1. `test_deliver_pending_assets_creates_real_assets_with_distinct_serials`
   — 3 `PendingAsset` rows (via `add_pending_asset_line(quantity=3)`),
   deliver all 3 with 3 different serial numbers and one shared invoice;
   assert 3 distinct `Asset` rows exist, each with the correct serial,
   the shared `invoice_number`/`invoice_date`, the parent PO's own
   `po_number`/`po_date`, `purchase_date == invoice_date`,
   `status == "IN_STOCK"`, and one `PROCURED`
   `AssetEvent` each.
2. `test_deliver_pending_assets_updates_line_status_and_traceability` —
   after delivery, each `PendingAsset.status == "DELIVERED"` and
   `delivered_asset_id` points at the correct new `Asset.id`.
3. `test_deliver_partial_selection_leaves_others_pending` — 5 lines
   created, only 3 delivered; the other 2 remain `PENDING`.
4. `test_deliver_rejects_an_already_delivered_line` — attempting to
   re-deliver a `DELIVERED` line raises `ValueError`, and does not affect
   any other line in the same batch that was still valid (i.e. call it
   with one already-delivered line mixed into an otherwise-valid batch
   and confirm the whole call raises before any further line is touched
   — the fail-fast behavior, not partial silent success).
5. `test_deliver_generates_sequential_distinct_asset_codes` — confirms no
   duplicate `asset_code` across the delivered batch (proves the existing
   numbering service is genuinely being reused, not bypassed).

- [ ] **Step 4: Run tests, confirm pass, commit**

```bash
docker compose up -d --build api
docker compose exec -T -e DATABASE_URL=postgresql+asyncpg://ckam:ckam_dev_pw@db:5432/ckam_test api python -m pytest tests/purchase_orders/ -q
git add backend/app/purchase_orders/service.py backend/app/purchase_orders/schemas.py backend/tests/purchase_orders/test_delivery.py
git commit -m "feat(purchase-orders): Delivery Done conversion via existing procure_assets"
```

---

## Task 4: Backend router + registration + full endpoint test coverage

**Files:**
- Create: `backend/app/purchase_orders/router.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/purchase_orders/test_router.py`

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: `router` (FastAPI `APIRouter`), registered in `main.py`,
  giving the frontend (Tasks 5-7) its real endpoints.

- [ ] **Step 1: Write `router.py`**

```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import ensure_company_in_scope, require_role, scoped_company_ids
from app.purchase_orders.models import PurchaseOrder, PendingAsset
from app.purchase_orders.schemas import (
    DeliveryDoneIn, PendingAssetLineIn, PendingAssetLineUpdateIn, PendingAssetOut,
    PurchaseOrderCreateIn, PurchaseOrderOut,
)
from app.purchase_orders.service import (
    add_pending_asset_line, cancel_pending_asset_line, create_purchase_order,
    deliver_pending_assets, update_pending_asset_line,
)

router = APIRouter(prefix="/api/purchase-orders", tags=["purchase-orders"])


async def _get_scoped_po(po_id: int, session: AsyncSession, holder) -> PurchaseOrder:
    po = await session.get(PurchaseOrder, po_id)
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "purchase order not found")
    allowed = scoped_company_ids(holder)
    if allowed is not None and po.company_id not in allowed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "purchase order not found")
    return po


@router.post("", response_model=PurchaseOrderOut, status_code=201)
async def create_po(
    body: PurchaseOrderCreateIn, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    ensure_company_in_scope(actor, body.company_id)
    po = await create_purchase_order(session, body.model_dump(), actor)
    await session.commit()
    await session.refresh(po)
    return po


@router.get("", response_model=list[PurchaseOrderOut])
async def list_pos(session: AsyncSession = Depends(get_session), holder=Depends(require_role("ADMIN", "IT_TEAM"))):
    allowed = scoped_company_ids(holder)
    stmt = select(PurchaseOrder).where(PurchaseOrder.is_active.is_(True))
    if allowed is not None:
        stmt = stmt.where(PurchaseOrder.company_id.in_(allowed))
    return (await session.execute(stmt.order_by(PurchaseOrder.id.desc()))).scalars().all()


@router.get("/{po_id}", response_model=PurchaseOrderOut)
async def get_po(po_id: int, session: AsyncSession = Depends(get_session), holder=Depends(require_role("ADMIN", "IT_TEAM"))):
    return await _get_scoped_po(po_id, session, holder)


@router.get("/{po_id}/lines", response_model=list[PendingAssetOut])
async def list_lines(po_id: int, session: AsyncSession = Depends(get_session), holder=Depends(require_role("ADMIN", "IT_TEAM"))):
    await _get_scoped_po(po_id, session, holder)
    stmt = select(PendingAsset).where(PendingAsset.purchase_order_id == po_id).order_by(PendingAsset.id)
    return (await session.execute(stmt)).scalars().all()


@router.post("/{po_id}/lines", response_model=list[PendingAssetOut], status_code=201)
async def add_line(
    po_id: int, body: PendingAssetLineIn, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    po = await _get_scoped_po(po_id, session, actor)
    try:
        lines = await add_pending_asset_line(session, po, body.model_dump(), actor)
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.commit()
    for line in lines:
        await session.refresh(line)
    return lines


@router.put("/lines/{line_id}", response_model=PendingAssetOut)
async def edit_line(
    line_id: int, body: PendingAssetLineUpdateIn, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    line = await session.get(PendingAsset, line_id)
    if line is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pending asset line not found")
    await _get_scoped_po(line.purchase_order_id, session, actor)
    try:
        line = await update_pending_asset_line(session, line, body.model_dump(), actor)
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.commit()
    await session.refresh(line)
    return line


@router.post("/lines/{line_id}/cancel", response_model=PendingAssetOut)
async def cancel_line(
    line_id: int, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    line = await session.get(PendingAsset, line_id)
    if line is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pending asset line not found")
    await _get_scoped_po(line.purchase_order_id, session, actor)
    try:
        line = await cancel_pending_asset_line(session, line, actor)
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.commit()
    await session.refresh(line)
    return line


@router.post("/{po_id}/deliver", response_model=list[PendingAssetOut])
async def deliver(
    po_id: int, body: DeliveryDoneIn, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    po = await _get_scoped_po(po_id, session, actor)
    line_ids = [d.pending_asset_id for d in body.lines]
    stmt = select(PendingAsset).where(PendingAsset.id.in_(line_ids), PendingAsset.purchase_order_id == po_id)
    lines = (await session.execute(stmt)).scalars().all()
    if len(lines) != len(line_ids):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "one or more selected lines do not belong to this purchase order")
    deliveries = {d.pending_asset_id: {"serial_number": d.serial_number, "initial_holder_id": d.initial_holder_id} for d in body.lines}
    try:
        delivered = await deliver_pending_assets(
            session, lines, deliveries, po.po_number, po.po_date,
            body.invoice_number, body.invoice_date, body.invoice_amount, actor,
        )
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.commit()
    for line in delivered:
        await session.refresh(line)
    return delivered
```

- [ ] **Step 2: Register the router in `main.py`**

Add `from app.purchase_orders.router import router as purchase_orders_router`
alongside the existing router imports, and
`app.include_router(purchase_orders_router)` alongside the existing
`include_router` calls.

- [ ] **Step 3: Write `test_router.py`**

Cover, mirroring `backend/tests/assets/test_router.py`'s style:

1. `test_create_po_and_add_line_happy_path` — `POST /api/purchase-orders`
   then `POST /api/purchase-orders/{id}/lines` with `quantity=2`, asserts
   `201` and 2 rows returned.
2. `test_add_line_rejects_cross_company_cost_centre` — `422`.
3. `test_edit_and_cancel_line` — `PUT .../lines/{id}` then `POST
   .../lines/{id}/cancel`; a second cancel attempt returns `422`.
4. `test_deliver_endpoint_creates_real_assets` — full flow: create PO →
   add 2 lines → `POST /{po_id}/deliver` with both lines' serials/holders
   and one shared invoice → `200`, both lines `DELIVERED`, and `GET
   /api/assets?company_id=...` shows the 2 new assets.
5. `test_deliver_rejects_a_line_from_a_different_po` — mixing a line id
   from another PO into the request body returns `422`, no line altered.
6. `test_company_isolation_on_po_read_and_write` — an IT_TEAM caller from
   Company B gets `404` on Company A's PO (`GET`, `add_line`, `deliver`),
   matching `_get_scoped_asset`'s own fail-closed-to-404 convention.
7. `test_viewer_and_holder_cannot_write` — `VIEWER`/`HOLDER` get `403` on
   every write endpoint (create PO, add line, edit, cancel, deliver);
   `VIEWER` gets `403` on the read endpoints too, since
   `require_role("ADMIN", "IT_TEAM")` is used on reads here as well
   (unlike Asset Register's own broader read access — POs are an
   internal procurement-tracking tool, not a report).
8. `test_pending_assets_never_appear_in_asset_register` — after adding
   pending lines (not delivered), `GET /api/assets` for that company
   still returns the same count as before — proves no accidental leak
   into the real Asset table before conversion.

- [ ] **Step 4: Run the full backend suite, confirm 0 regressions, commit**

```bash
docker compose up -d --build api
docker compose exec -T -e DATABASE_URL=postgresql+asyncpg://ckam:ckam_dev_pw@db:5432/ckam_test api python -m pytest -q
```
Expected: `312 + (new test count) passed`.

```bash
git add backend/app/purchase_orders/router.py backend/app/main.py backend/tests/purchase_orders/test_router.py
git commit -m "feat(purchase-orders): API endpoints + router registration"
```

---

## Task 5: Frontend — Purchase Orders list + New PO screens

**Files:**
- Create: `frontend/src/features/purchase-orders/PurchaseOrdersList.tsx`
- Create: `frontend/src/features/purchase-orders/PurchaseOrdersList.test.tsx`
- Create: `frontend/src/features/purchase-orders/NewPurchaseOrderForm.tsx`
- Create: `frontend/src/features/purchase-orders/NewPurchaseOrderForm.test.tsx`
- Create: `frontend/src/routes/purchase-orders/index.tsx`
- Create: `frontend/src/routes/purchase-orders/new.tsx`
- Modify: `frontend/src/router.tsx`

**Interfaces:**
- Consumes: `GET /api/purchase-orders`, `POST /api/purchase-orders` (Task
  4); `GET /masters/vendors` (existing, unchanged).
- Produces: `/purchase-orders` and `/purchase-orders/new` routes, reused
  by Task 6/7's PO-detail link-through.

- [ ] **Step 1: Write `PurchaseOrdersList.tsx`**

Mirror `frontend/src/features/assets/AssetRegister.tsx`'s top-level
shape (a `useQuery` list, `DataTable`, `PageHeader` with a "New Purchase
Order" `Link` action) — columns: PO No (linked to `/purchase-orders/$id`),
PO Date, Vendor name (resolve via a small `useQuery(["masters",
"vendors"])` id→name map, same pattern `AssetRegister`'s own Holder/
Company columns use), Line counts (fetch `GET /api/purchase-orders`
first, then per-row `GET /{id}/lines` is too chatty — instead, extend
`PurchaseOrderOut` is out of scope for this task; simplest correct
option: omit a line-count column here entirely and show it only on the
PO detail page in Task 6, since the list's job is just to find and open a
PO). `EmptyState` title: `"No purchase orders yet."`.

- [ ] **Step 2: Write `PurchaseOrdersList.test.tsx`**

Mirror `AssetRegister.test.tsx`'s render-through-real-router pattern
(`createAppRouter` + `RouterProvider`, since the row links use `<Link>`).
Cover: renders a list of 2 mocked POs; shows `EmptyState` on an empty
list; "New Purchase Order" link navigates to `/purchase-orders/new`.

- [ ] **Step 3: Write `NewPurchaseOrderForm.tsx`**

Mirror `AddAssetForm.tsx`'s shape (`FormField` primitives, a `Select` for
Vendor sourced from `GET /masters/vendors`, `Input` for PO No/Date), a
`useMutation` posting to `POST /api/purchase-orders`, and on success
`navigate({ to: "/purchase-orders/$id", params: { id: String(created.id) } })`
— landing directly on the new PO's detail page (Task 6) to start adding
lines, mirroring Add Asset's own "navigate straight to the new asset's
360 page" pattern.

- [ ] **Step 4: Write `NewPurchaseOrderForm.test.tsx`**

Cover: required-field validation (PO No/Date) blocks submit; a
successful submit calls `POST /api/purchase-orders` with the right body
and navigates to the new PO's detail route; a server-side validation
error renders inline (mirror `AddAssetForm.test.tsx`'s own error-display
test).

- [ ] **Step 5: Wire the two new routes into `router.tsx`**

```tsx
export const purchaseOrdersIndexRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/purchase-orders",
  component: PurchaseOrdersIndexRoute,
});

export const purchaseOrdersNewRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/purchase-orders/new",
  component: NewPurchaseOrderRoute,
});
```

Add both to the route tree's children array (alongside
`assetsIndexRoute`/`assetsNewRoute`), and add a new sidebar entry in the
existing "Assets" `SidebarGroup` (same block as "Add Asset"/"Import"):

```tsx
{canWrite && <SidebarNavItem to="/purchase-orders" label="Purchase Orders" icon={ClipboardList} />}
```

(Import `ClipboardList` from `lucide-react` alongside the existing icon
imports at the top of `router.tsx`.) `canWrite` already gates this to
ADMIN/IT_TEAM, matching Task 4's backend role gate exactly.

- [ ] **Step 6: Typecheck, run tests, rebuild, commit**

```bash
cd frontend && npx tsc -b && npx vitest run
docker compose up -d --build web
git add frontend/src/features/purchase-orders/PurchaseOrdersList.tsx frontend/src/features/purchase-orders/PurchaseOrdersList.test.tsx frontend/src/features/purchase-orders/NewPurchaseOrderForm.tsx frontend/src/features/purchase-orders/NewPurchaseOrderForm.test.tsx frontend/src/routes/purchase-orders frontend/src/router.tsx
git commit -m "feat(purchase-orders): Purchase Orders list + New PO screens"
```

---

## Task 6: Frontend — PO detail screen (lines table, add/edit/cancel line)

**Files:**
- Create: `frontend/src/features/purchase-orders/PurchaseOrderDetail.tsx`
- Create: `frontend/src/features/purchase-orders/PurchaseOrderDetail.test.tsx`
- Create: `frontend/src/routes/purchase-orders/$id.tsx`
- Modify: `frontend/src/router.tsx`

**Interfaces:**
- Consumes: `GET /api/purchase-orders/{id}`, `GET
  /api/purchase-orders/{id}/lines`, `POST /api/purchase-orders/{id}/lines`,
  `PUT /api/purchase-orders/lines/{id}`, `POST
  /api/purchase-orders/lines/{id}/cancel` (Task 4).
- Produces: the screen Task 7's Delivery Done dialog attaches to
  (selection state + a "Mark Delivery Done" button).

- [ ] **Step 1: Write `PurchaseOrderDetail.tsx`**

Structure: `PageHeader` (PO No/Date/Vendor), an "Add Line" form section
(same field set as `PendingAssetLineIn`, reusing `FormField`/`Select`/
`Input`, with a `Quantity` number input defaulting to 1), and a
`DataTable` of this PO's own lines with a `PENDING`/`DELIVERED`/
`CANCELLED` `StatusBadge`-style badge (add a small local status→tone map
in this file, e.g. `PENDING: "warning"`, `DELIVERED: "success"`,
`CANCELLED: "neutral"` — do **not** touch the existing `StatusBadge`
component's `ASSET_STATUS_TONE` map, since these are a different,
unrelated status vocabulary). Each `PENDING` row gets an Edit action
(inline or a small dialog, mirroring `MasterCrudScreen`'s own edit-dialog
pattern) and a Cancel action (a confirm-then-`AsyncButton`, mirroring
`HoldersScreen`'s own Deactivate confirmation). Selection: a checkbox
column on `PENDING` rows only (mirror `AssetRegister`'s own
`DataTableSelection` usage), plus a "Mark Delivery Done" `AsyncButton`
enabled only when ≥1 row is selected — its `onClick` opens the dialog
Task 7 builds (left as a `TODO` stub in this task: `const [deliverOpen,
setDeliverOpen] = useState(false)`, button just sets it true; the actual
`<Dialog>` content is Task 7's own step, added in the same file).

- [ ] **Step 2: Write `PurchaseOrderDetail.test.tsx`**

Cover: renders PO header + a mocked lines table; Add Line form posts the
right body including `quantity`; Edit opens with the line's current
values pre-filled and PUTs the update; Cancel confirms then POSTs cancel;
a `DELIVERED` row shows no Edit/Cancel actions and no selection checkbox
(mirroring the immutability rule from the spec's §5).

- [ ] **Step 3: Wire the route**

```tsx
export const purchaseOrderDetailRoute = createRoute({
  getParentRoute: () => authedLayoutRoute,
  path: "/purchase-orders/$id",
  component: function PurchaseOrderDetailComponent() {
    const { id } = purchaseOrderDetailRoute.useParams();
    return <PurchaseOrderDetailRoute params={{ id }} />;
  },
});
```
Add to the route tree's children array, same pattern as
`assetDetailRoute`.

- [ ] **Step 4: Typecheck, run tests, rebuild, commit**

```bash
cd frontend && npx tsc -b && npx vitest run
docker compose up -d --build web
git add frontend/src/features/purchase-orders/PurchaseOrderDetail.tsx frontend/src/features/purchase-orders/PurchaseOrderDetail.test.tsx frontend/src/routes/purchase-orders/\$id.tsx frontend/src/router.tsx
git commit -m "feat(purchase-orders): PO detail screen with line add/edit/cancel"
```

---

## Task 7: Frontend — Delivery Done dialog

**Files:**
- Modify: `frontend/src/features/purchase-orders/PurchaseOrderDetail.tsx`
- Modify: `frontend/src/features/purchase-orders/PurchaseOrderDetail.test.tsx`

**Interfaces:**
- Consumes: `POST /api/purchase-orders/{id}/deliver` (Task 4); `GET
  /api/holders?company_id=...` (existing, for the per-row Initial Holder
  `Select`, same query `AddAssetForm.tsx` already makes).

- [ ] **Step 1: Add the Delivery Done dialog**

Mirror `AssetRegister.tsx`'s own bulk-Move `Dialog` structure exactly
(`Dialog open={deliverOpen} onOpenChange={...}` → `DialogContent` →
`DialogHeader`/`DialogTitle` ("Mark N asset(s) delivered") → body → `
DialogFooter`). Body: three shared `Input`s (Invoice No, Invoice Date,
Invoice Amount) at the top, then one row per selected `PendingAsset`
showing its description + a `Serial Number` `Input` + an `Initial
Holder` `Select` (options from `GET /api/holders?company_id=...`,
filtered client-side to the PO's own company, matching
`AddAssetForm.tsx`'s own holder-dropdown query). A `useMutation` posting
`DeliveryDoneIn` to `POST /api/purchase-orders/{id}/deliver`; on success,
invalidate the lines query (`qc.invalidateQueries(["purchase-order",
id, "lines"])`) so delivered rows immediately show `DELIVERED` and drop
out of the selectable set, and close the dialog. The Confirm button is
disabled until every selected row has both Serial Number and Initial
Holder filled, and until Invoice No/Date/Amount are all filled — mirror
`AssetRegister.tsx`'s own `canSave`-style computed-boolean pattern (AM-08).

- [ ] **Step 2: Extend `PurchaseOrderDetail.test.tsx`**

Cover: selecting 2 `PENDING` rows and clicking "Mark Delivery Done" opens
the dialog with 2 per-row serial/holder inputs; Confirm is disabled until
every required field (shared + per-row) is filled; a successful submit
posts the correct `DeliveryDoneIn` shape (one invoice block, an array of
per-line `{pending_asset_id, serial_number, initial_holder_id}`) and the
delivered rows show a `DELIVERED` badge afterward; a server-side `422`
(e.g. a line already delivered by someone else) shows an inline error
and does not close the dialog.

- [ ] **Step 3: Typecheck, run tests, rebuild, live UAT, commit**

```bash
cd frontend && npx tsc -b && npx vitest run
docker compose up -d --build web
```

Live UAT (browser), using the AM-11 test-data convention
(`UAT-AM13-...` — treat this feature as the next stage number in
sequence if you continue the project's own stage-numbering habit, or
just `UAT-PO-...` if not): create a company, a Cost Centre/Category/
Subcategory, an `IT_STOCK` holder; create a PO; add a line with
Quantity 3; confirm 3 pending rows appear; select 2 of the 3, mark
delivery done with distinct serials; confirm those 2 now show
`DELIVERED` and appear in the real Asset Register with the correct
serial/invoice/PO fields, while the 3rd stays `PENDING` and does **not**
appear in the Asset Register; confirm a `VIEWER`/`HOLDER` account cannot
reach `/purchase-orders` at all (no sidebar link, and a direct-URL visit
still 403s from the backend).

```bash
git add frontend/src/features/purchase-orders/PurchaseOrderDetail.tsx frontend/src/features/purchase-orders/PurchaseOrderDetail.test.tsx
git commit -m "feat(purchase-orders): Delivery Done dialog, converts pending lines into real assets"
```

---

## Task 8: Final full regression + documentation

**Files:**
- Modify: `docs/ai/PRODUCT_CONTEXT.md` (module map table gains a
  "Purchase Orders" row)
- Modify: `docs/ai/DECISIONS.md` (record the role-gate decision once
  finalized, and the design choices from the spec's §10)
- Modify: `docs/ai/CURRENT_STAGE.md`

- [ ] **Step 1: Run the complete regression suite**

```bash
docker compose exec -T -e DATABASE_URL=postgresql+asyncpg://ckam:ckam_dev_pw@db:5432/ckam_test api python -m pytest -q
cd frontend && npx tsc -b && npx vitest run
E2E_BASE_URL=http://localhost:3211 npx playwright test
npm run build
```
Every existing test must still pass; no existing screen's behavior
should have changed (Add Asset, Asset Register, Dashboard are all
untouched by this feature per the spec's own explicit scope).

- [ ] **Step 2: Update `docs/ai/PRODUCT_CONTEXT.md`'s module map table**

Add a row: `| Purchase Orders (pre-delivery asset staging) | app/purchase_orders/
| routes/purchase-orders/*.tsx via features/purchase-orders/{PurchaseOrdersList,NewPurchaseOrderForm,PurchaseOrderDetail}.tsx |`.

- [ ] **Step 3: Update `docs/ai/DECISIONS.md`**

Record: the two-table additive design (no change to `Asset`'s own
schema); conversion reuses `procure_assets` unchanged; Delivery Done
scoped to one PO at a time; the finalized role gate (ADMIN/IT_TEAM,
unless changed during implementation — record whatever was actually
shipped, not the plan's default, if it changed).

- [ ] **Step 4: Update `docs/ai/CURRENT_STAGE.md`**

Record this feature as delivered, referencing the spec and this plan.

- [ ] **Step 5: Final commit**

```bash
git add docs/ai/PRODUCT_CONTEXT.md docs/ai/DECISIONS.md docs/ai/CURRENT_STAGE.md
git commit -m "docs(ai): Purchase Orders / Pending Assets feature — governance updates"
```
