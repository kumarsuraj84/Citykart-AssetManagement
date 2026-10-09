from sqlalchemy import BigInteger, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base
from app.core.models import AuditMixin


class ItemCatalog(Base, AuditMixin):
    """What the system remembers about an item code (CT324973) after someone
    confirmed it once on the PO review screen: so the next PO line with that
    code arrives with its category, sub-category, brand, model and warranty
    filled in -- or already marked as a bundle (a Desktop). A memory only; it
    is never required and nothing reads it at the asset level."""
    __tablename__ = "item_catalog"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    item_code: Mapped[str] = mapped_column(String(50))
    group_code: Mapped[str | None] = mapped_column(String(50))
    category_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("asset_category.id"))
    subcategory_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("asset_subcategory.id"))
    brand_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("brand.id"))
    model: Mapped[str | None] = mapped_column(String(200))
    warranty_years: Mapped[int | None] = mapped_column(Integer)
    bundle_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("bundle.id"))
