from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.assets.models import Asset


async def search_assets(
    session: AsyncSession,
    allowed_company_ids: list[int] | None,
    status: str | None = None,
    category_id: int | None = None,
    holder_id: int | None = None,
    company_id: int | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[Asset], int]:
    stmt = select(Asset).where(Asset.deleted_at.is_(None))
    if allowed_company_ids is not None:
        stmt = stmt.where(Asset.company_id.in_(allowed_company_ids))
    if company_id is not None:
        stmt = stmt.where(Asset.company_id == company_id)
    if status is not None:
        stmt = stmt.where(Asset.status == status)
    if category_id is not None:
        stmt = stmt.where(Asset.category_id == category_id)
    if holder_id is not None:
        stmt = stmt.where(Asset.current_holder_id == holder_id)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(or_(
            Asset.asset_code.ilike(pattern), Asset.legacy_asset_code.ilike(pattern),
            Asset.serial_number.ilike(pattern), Asset.po_number.ilike(pattern),
            Asset.invoice_number.ilike(pattern), Asset.pi_number.ilike(pattern),
        ))

    total = len((await session.execute(stmt)).scalars().all())
    page_stmt = stmt.order_by(Asset.id.desc()).limit(limit).offset(offset)
    items = (await session.execute(page_stmt)).scalars().all()
    return items, total
