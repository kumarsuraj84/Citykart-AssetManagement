"""S0 (simplification programme): small, shared request-validation helpers.

Everything here protects *new writes* only -- nothing re-validates rows that are
already stored. Messages are plain business sentences (no ids, enum names or
database text), because they are shown to the user as they are.

Limits that match the database column sizes live next to the schemas that use
them (`Field(max_length=...)`); FastAPI's validation errors for those are turned
into "X is too long (max N characters)." by app.core.errors.
"""
from __future__ import annotations

import re
from datetime import date

from pydantic import BaseModel, model_validator

# One request may never create more than this many units/rows (PO line
# quantity, bundles, ERP draft line, Excel quantity) or name more than this
# many ids (bulk move/action). Keeps a single request from allocating unbounded
# memory (audit Appendix B-2).
MAX_QUANTITY = 1000
MAX_BULK_IDS = 1000

# Money columns are Numeric(14, 2): anything at or above 10^12 overflows the
# column (a bare 500 before S0). 10 billion is far above any real asset cost.
MAX_AMOUNT = 9_999_999_999
MAX_WARRANTY_YEARS = 100
EARLIEST_PURCHASE_DATE = date(1990, 1, 1)

NUL = "\x00"

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
# 15 characters: 2-digit state code, 10-character PAN, entity number, Z, check character.
_GSTIN_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")


def _has_nul(value) -> bool:
    if isinstance(value, str):
        return NUL in value
    if isinstance(value, dict):
        return any(_has_nul(k) or _has_nul(v) for k, v in value.items())
    if isinstance(value, (list, tuple)):
        return any(_has_nul(v) for v in value)
    return False


class InModel(BaseModel):
    """Base for request bodies: refuses text that carries a NUL character
    (PostgreSQL cannot store it, which used to surface as a bare 500)."""

    @model_validator(mode="before")
    @classmethod
    def _no_nul_characters(cls, data):
        if _has_nul(data):
            raise ValueError("Text cannot contain hidden control characters. Remove them and try again.")
        return data


def clean_optional(value: str | None) -> str | None:
    """Trims; blank becomes None."""
    if value is None:
        return None
    value = value.strip()
    return value or None


def require_text(value: str | None, label: str) -> str:
    """Trims and refuses blank text."""
    value = (value or "").strip()
    if not value:
        raise ValueError(f"{label} cannot be blank.")
    return value


def check_email(value: str | None, label: str = "Email") -> str | None:
    value = clean_optional(value)
    if value is not None and not _EMAIL_RE.match(value):
        raise ValueError(f"{label} is not a valid email address.")
    return value


def check_gstin(value: str | None) -> str | None:
    value = clean_optional(value)
    if value is None:
        return None
    value = value.upper()
    if not _GSTIN_RE.match(value):
        raise ValueError("GSTIN is not valid. It has 15 characters, for example 07AAAAA0000A1Z5.")
    return value


def not_in_future(value: date | None, label: str) -> date | None:
    if value is not None and value > date.today():
        raise ValueError(f"{label} cannot be in the future.")
    return value


def parse_work_area(value: str | None) -> str | None:
    """S5: a work-area filter ("IT", "NON_IT", "Non-IT", "non it", any case) -> IT / NON_IT; None when not
    given; ValueError in words otherwise."""
    if value is None or not value.strip():
        return None
    text = value.strip().upper().replace("-", "_").replace(" ", "_")
    if text in ("IT", "NON_IT"):
        return text
    raise ValueError("Choose a work area: IT or Non-IT.")


def escape_like(value: str) -> str:
    """For LIKE/ILIKE with escape='\\': a typed %, _ or \\ matches itself."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
