from sqlalchemy import BigInteger, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base
from app.core.models import SoftDeleteMixin


class CodeRule(Base, SoftDeleteMixin):
    __tablename__ = "code_rule"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    company_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("company.id"))
    prefix_template: Mapped[str] = mapped_column(String(300))
    suffix_template: Mapped[str] = mapped_column(String(100), default="")
    start_number: Mapped[int] = mapped_column(Integer, default=1)
    pad_width: Mapped[int] = mapped_column(Integer, default=0)


class CodeCounter(Base):
    __tablename__ = "code_counter"
    resolved_prefix: Mapped[str] = mapped_column(String(400), primary_key=True)
    next_value: Mapped[int] = mapped_column(BigInteger, nullable=False)
