from datetime import datetime
from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base

DOC_TYPES = ("invoice", "po", "warranty_card", "photo", "other")


class AssetDocument(Base):
    __tablename__ = "asset_document"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    asset_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("asset.id"))
    doc_type: Mapped[str] = mapped_column(String(20))
    file_name: Mapped[str] = mapped_column(String(300))
    stored_path: Mapped[str] = mapped_column(String(500))
    mime_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(Integer)
    uploaded_by: Mapped[int] = mapped_column(BigInteger, ForeignKey("holder.id"))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
