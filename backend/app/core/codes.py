"""S3a-1: readable codes made from a name, for records added in the flow
(vendor, brand, cost centre, a stock room's location and the stock room
itself) when nobody typed a code.

"Vansh Enterprises Pvt. Ltd." -> "VANSHENTERPRISESPVTLTD" (cut to the length
allowed); a clash -- ignoring letter case and surrounding spaces, against every
row of the scope, active or not, since the database's unique key covers them
all -- gets a number: "DELL", "DELL2", "DELL3" ... (with a `separator`,
"STK-HOSTOCK", "STK-HOSTOCK-2"). The base is shortened so the number always
fits."""
from __future__ import annotations

import re

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

_NOT_CODE = re.compile(r"[^A-Z0-9]+")


def code_base(name: str | None, fallback: str) -> str:
    base = _NOT_CODE.sub("", (name or "").upper())
    return base or fallback


async def unique_code(
    session: AsyncSession, model, name: str | None, *, max_length: int, fallback: str,
    prefix: str = "", separator: str = "", scope: dict | None = None,
) -> str:
    """A code for `name` that no row of `model` (within `scope`, e.g.
    {"company_id": 3}) already has, ignoring case and surrounding spaces."""
    base = (prefix + code_base(name, fallback))[:max_length]
    stmt = select(func.upper(func.trim(model.code)))
    for key, value in (scope or {}).items():
        stmt = stmt.where(getattr(model, key) == value)
    stem = base[:max(1, max_length - 6)]          # every candidate starts with this
    stmt = stmt.where(func.upper(func.trim(model.code)).like(stem.replace("\\", "\\\\").replace("%", "\\%")
                                                              .replace("_", "\\_") + "%", escape="\\"))
    taken = set((await session.execute(stmt)).scalars().all())
    if base not in taken:
        return base
    number = 2
    while True:
        suffix = f"{separator}{number}"
        candidate = base[:max_length - len(suffix)] + suffix
        if candidate not in taken:
            return candidate
        number += 1
