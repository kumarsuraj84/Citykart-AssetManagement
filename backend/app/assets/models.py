from datetime import date, datetime
from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, JSON, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base
from app.core.models import AuditMixin

ASSET_STATUSES = ("IN_STOCK", "ALLOTTED", "INSTALLED", "UNDER_REPAIR", "DISPOSED", "SOLD", "SCRAPPED", "LOST")


class Asset(Base, AuditMixin):
    __tablename__ = "asset"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    """Soft-delete for a data-entry mistake only (spec §4.4, §7) — never used to remove an
    asset that has left PROCURED; that's what the DISPOSED/SOLD/SCRAPPED/LOST terminal
    states are for. Enforced by the delete endpoint added in Task 16."""
    asset_code: Mapped[str] = mapped_column(String(200), unique=True)
    legacy_asset_code: Mapped[str | None] = mapped_column(String(200))
    company_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("company.id"))
    cost_center_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("cost_center.id"))
    category_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("asset_category.id"))
    subcategory_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("asset_subcategory.id"))
    brand: Mapped[str | None] = mapped_column(String(200))
    model: Mapped[str | None] = mapped_column(String(200))
    serial_number: Mapped[str | None] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(String(500))

    vendor_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("vendor.id"))
    po_number: Mapped[str | None] = mapped_column(String(100))
    po_date: Mapped[date | None] = mapped_column(Date)
    invoice_number: Mapped[str | None] = mapped_column(String(100))
    invoice_date: Mapped[date | None] = mapped_column(Date)
    pi_number: Mapped[str | None] = mapped_column(String(100))
    pi_date: Mapped[date | None] = mapped_column(Date)
    purchase_cost: Mapped[float | None] = mapped_column(Numeric(14, 2))
    tax_percent: Mapped[float | None] = mapped_column(Numeric(5, 2))
    tax_amount: Mapped[float | None] = mapped_column(Numeric(14, 2))
    total_cost: Mapped[float | None] = mapped_column(Numeric(14, 2))
    purchase_date: Mapped[date] = mapped_column(Date)
    warranty_upto: Mapped[date | None] = mapped_column(Date)

    status: Mapped[str] = mapped_column(String(20))
    current_holder_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("holder.id"))
    status_since: Mapped[date] = mapped_column(Date)

    custom_fields: Mapped[dict] = mapped_column(JSON, default=dict)
