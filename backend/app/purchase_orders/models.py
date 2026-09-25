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
