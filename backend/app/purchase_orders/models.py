from datetime import date, datetime
from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, UniqueConstraint, func
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
    cost_center_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("cost_center.id"))
    # Where the goods arrive: Mark Delivery Done pre-selects this stock point as
    # the Initial Asset User. warehouse_code is the text it was derived from
    # (e.g. CKSPL-WH-TAJNAGAR), kept so the choice is remembered per warehouse.
    delivery_asset_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("asset_user.id"))
    warehouse_code: Mapped[str | None] = mapped_column(String(100))
    # The ERP purchase order this was created from (unique when set).
    erp_po_code: Mapped[int | None] = mapped_column(BigInteger)
    # What the ERP said about the PO header when this PO was made (or when its changes were last
    # looked at); a later difference is "the ERP changed this PO". The item lines are in
    # PurchaseOrderErpBaseline.
    erp_status: Mapped[str | None] = mapped_column(String(30))
    erp_supplier_code: Mapped[str | None] = mapped_column(String(50))
    erp_delivery_location: Mapped[str | None] = mapped_column(String(200))
    erp_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PurchaseOrderErpBaseline(Base):
    """What the ERP said about one item code of a PO when CKAM last agreed with it: the quantity
    after cancellations, the rate and the tax %. The ERP keeps no edit history, so "changed" means
    different from this."""
    __tablename__ = "purchase_order_erp_baseline"
    __table_args__ = (UniqueConstraint("purchase_order_id", "item_code", name="uq_po_erp_baseline_item"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    purchase_order_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("purchase_order.id"))
    item_code: Mapped[str] = mapped_column(String(50))
    qty: Mapped[float] = mapped_column(Numeric(14, 3))
    rate: Mapped[float] = mapped_column(Numeric(14, 4))
    tax_percent: Mapped[float | None] = mapped_column(Numeric(6, 2))


class PurchaseOrderErpChange(Base):
    """A change the ERP made to a PO that a person applied here (or chose to keep as it is)."""
    __tablename__ = "purchase_order_erp_change"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    purchase_order_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("purchase_order.id"))
    actor_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("asset_user.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    kind: Mapped[str] = mapped_column(String(30))
    item_code: Mapped[str | None] = mapped_column(String(50))
    summary: Mapped[str] = mapped_column(String(500))


class PendingAsset(Base, AuditMixin):
    """One row per physical unit ordered under a PurchaseOrder. Not an
    Asset -- never appears in the Asset Register/Dashboard/exports.
    Converts into a real Asset (via app.assets.service.procure_assets,
    unchanged) at Delivery Done; this row is then frozen and kept as the
    traceability record (delivered_asset_id), never deleted."""
    __tablename__ = "pending_asset"
    __table_args__ = (Index("ix_pending_asset_po_line_no", "purchase_order_id", "line_no"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    purchase_order_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("purchase_order.id"))
    # S2.4: the number (1..n within its PO) of the line this unit was ordered
    # on; every unit of one line shares it, and it never changes afterwards
    # (an edit keeps it). Nullable only for forward-compat; the migration
    # b8d0f2a4c6e8 numbered every existing unit and every creation path
    # assigns one (app.purchase_orders.service.next_line_no).
    line_no: Mapped[int | None] = mapped_column(Integer)
    company_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("company.id"))
    description: Mapped[str] = mapped_column(String(500))
    barcode: Mapped[str | None] = mapped_column(String(200))
    """Entered once per line (like description/cost), shared by every unit
    that line's quantity creates -- CityKart's own internal barcode, not
    unique like a manufacturer serial number (docs/ai/DECISIONS.md)."""
    category_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("asset_category.id"))
    subcategory_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("asset_subcategory.id"))
    cost_center_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("cost_center.id"))
    brand_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("brand.id"))
    model: Mapped[str | None] = mapped_column(String(200))
    warranty_years: Mapped[int | None] = mapped_column(Integer)
    """AM-18: entered once per line, like barcode/description -- shared by
    every unit this line's quantity creates. Converted into the delivered
    Asset's own warranty_years (and, from that, its computed warranty_upto)
    at Delivery Done -- see app.purchase_orders.service.deliver_pending_assets."""
    purchase_cost: Mapped[float | None] = mapped_column(Numeric(14, 2))
    tax_percent: Mapped[float | None] = mapped_column(Numeric(5, 2))
    tax_amount: Mapped[float | None] = mapped_column(Numeric(14, 2))
    total_cost: Mapped[float | None] = mapped_column(Numeric(14, 2))

    status: Mapped[str] = mapped_column(String(20), default="PENDING")

    # False for a part that never carries a serial (a mouse, a keyboard): the
    # delivery dialog then starts with "No serial number" ticked. Ordinary
    # lines are True. bundle_label names the bundle ("Desktop") a line came
    # from, shown as a tag; null for ordinary lines.
    serial_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    # Snapshot of Item.serial_later: delivery starts with "serial later" ticked.
    serial_later: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    bundle_label: Mapped[str | None] = mapped_column(String(100))
    # The Item this unit is (see app.items), and the ERP item code it was ordered
    # under -- carried onto the Asset at delivery. Both optional: lines typed by
    # hand have neither.
    item_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("item.id"))
    erp_item_code: Mapped[str | None] = mapped_column(String(50))

    # IT / NON_IT, derived server-side from Category.asset_domain when the
    # line is created (spec §19) -- copied onto Asset.asset_domain unchanged
    # at Delivery Done. Nullable: older rows created before this column
    # existed never get backfilled (the table is empty in every environment
    # audited so far, but the column stays nullable for forward-compat).
    asset_domain: Mapped[str | None] = mapped_column(String(10))

    serial_number: Mapped[str | None] = mapped_column(String(200))
    invoice_number: Mapped[str | None] = mapped_column(String(100))
    invoice_date: Mapped[date | None] = mapped_column(Date)
    invoice_amount: Mapped[float | None] = mapped_column(Numeric(14, 2))
    initial_asset_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("asset_user.id"))

    delivered_asset_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("asset.id"))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_by: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("asset_user.id"))
