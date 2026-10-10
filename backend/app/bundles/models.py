from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Integer, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base
from app.core.models import AuditMixin, SoftDeleteMixin


class Bundle(Base, AuditMixin, SoftDeleteMixin):
    """A purchase-time shortcut, NOT an asset category: "Desktop" = CPU + TFT +
    Keyboard + Mouse. Adding a bundle to a Purchase Order expands into ordinary
    PendingAsset lines, one per part, each under that part's own real category;
    no "Desktop" asset ever exists in the Asset Register."""
    __tablename__ = "bundle"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(100))


class BundlePart(Base, AuditMixin, SoftDeleteMixin):
    __tablename__ = "bundle_part"
    __table_args__ = (CheckConstraint("share_percent > 0 AND share_percent <= 100", name="ck_bundle_part_share"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    bundle_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("bundle.id"))
    name: Mapped[str] = mapped_column(String(100))
    # The Item this part is (CPU, TFT, Keyboard, Mouse). Category and
    # sub-category are copied from it when the part is saved, and the serial
    # default (a mouse needs none) comes from the Item (app.masters.serial_rule).
    # None only for a part that predates Items and could not be given one.
    item_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("item.id"))
    category_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("asset_category.id"))
    subcategory_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("asset_subcategory.id"))
    # This part's share of the bundle price before tax; the active parts of a
    # bundle always add up to exactly 100.
    share_percent: Mapped[float] = mapped_column(Numeric(5, 2))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
