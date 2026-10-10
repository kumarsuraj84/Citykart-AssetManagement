from sqlalchemy import BigInteger, Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base
from app.core.models import AuditMixin, SoftDeleteMixin

MATCH_TYPES = ("CODE", "NAME", "ARTICLE")


class Item(Base, AuditMixin, SoftDeleteMixin):
    """What an asset IS, in CityKart's own words ("Cassette AC", "Floor Gondola",
    "UPS"). Many ERP item codes (one per vendor / spec) point to one Item; the
    asset keeps the ERP code only as a link back to its PO, receipt and PI.
    Category / Sub-Category stay underneath as the internal classification the
    asset code, reports and Responsibility (IT / Non-IT) already use."""
    __tablename__ = "item"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    category_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("asset_category.id"))
    subcategory_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("asset_subcategory.id"))
    # None = follow the sub-category / category; True / False overrides them.
    serial_required: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # A Desktop-style item that becomes several assets (one per part).
    bundle_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("bundle.id"))
    default_brand_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("brand.id"))
    default_warranty_years: Mapped[int | None] = mapped_column(Integer)


class ItemMap(Base, AuditMixin, SoftDeleteMixin):
    """Which Item an ERP item code belongs to. Looked up most specific first:
    CODE (one ERP item code) > NAME (a product name inside one Article, for
    catch-all Articles such as FA_IT_OTHERS) > ARTICLE (every code of the
    Article, the normal case, so a new vendor code lands on the right Item by
    itself). Section / Department / Article names are stored as a snapshot so
    an ERP rename never changes history."""
    __tablename__ = "item_map"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    item_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("item.id"))
    # Whose ERP master the rule is for (CKSPL's and CVSPL's masters differ: same
    # product, different codes / Articles). None = every company; a company's own
    # rule beats an every-company rule.
    company_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("company.id"))
    match_type: Mapped[str] = mapped_column(String(10))
    article_key: Mapped[str | None] = mapped_column(String(300))
    name_key: Mapped[str | None] = mapped_column(String(300))
    erp_item_code: Mapped[str | None] = mapped_column(String(50))
    section: Mapped[str | None] = mapped_column(String(200))
    department: Mapped[str | None] = mapped_column(String(200))
    article_name: Mapped[str | None] = mapped_column(String(300))
    note: Mapped[str | None] = mapped_column(String(300))
