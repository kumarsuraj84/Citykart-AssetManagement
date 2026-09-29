from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.assets.models import Asset

# AM-21: an explicit whitelist, never the raw client-supplied string, used
# directly as a SQLAlchemy column reference -- prevents both SQL injection
# and sorting by a column that isn't meant to be exposed (e.g. deleted_at).
# Deliberately real Asset columns only; the register's *_name columns
# (asset_user/company/category/...) are page-scoped label lookups, not sortable
# database columns, so they're left out of this pass.
SORTABLE_COLUMNS: dict[str, object] = {
    "asset_code": Asset.asset_code,
    "legacy_asset_code": Asset.legacy_asset_code,
    "description": Asset.description,
    "model": Asset.model,
    "serial_number": Asset.serial_number,
    "barcode": Asset.barcode,
    "po_number": Asset.po_number,
    "po_date": Asset.po_date,
    "invoice_number": Asset.invoice_number,
    "invoice_date": Asset.invoice_date,
    "invoice_amount": Asset.invoice_amount,
    "pi_number": Asset.pi_number,
    "pi_date": Asset.pi_date,
    "purchase_cost": Asset.purchase_cost,
    "tax_percent": Asset.tax_percent,
    "tax_amount": Asset.tax_amount,
    "total_cost": Asset.total_cost,
    "purchase_date": Asset.purchase_date,
    "warranty_years": Asset.warranty_years,
    "warranty_upto": Asset.warranty_upto,
    "status": Asset.status,
    "status_since": Asset.status_since,
}


async def search_assets(
    session: AsyncSession,
    allowed_company_ids: list[int] | None,
    status: str | None = None,
    category_id: int | None = None,
    asset_user_id: int | None = None,
    company_id: int | None = None,
    q: str | None = None,
    sort_by: str | None = None,
    sort_dir: str = "asc",
    limit: int = 50,
    offset: int = 0,
    allowed_domains: tuple[str, ...] | None = None,
    domain: str | None = None,
) -> tuple[list[Asset], int]:
    """`allowed_domains` (from app.core.deps.allowed_asset_domains) is the
    caller's server-side scope -- None means unrestricted (ADMIN/SELF_SERVICE),
    a tuple means the caller may only ever see those domains, enforced
    unconditionally (spec §14/§15). `domain` is the optional user-requested
    "Responsibility" filter (spec §22) -- further narrows within whatever
    `allowed_domains` already permits; a caller can never widen past their
    own scope by passing a domain outside it."""
    stmt = select(Asset).where(Asset.deleted_at.is_(None))
    if allowed_company_ids is not None:
        stmt = stmt.where(Asset.company_id.in_(allowed_company_ids))
    if company_id is not None:
        stmt = stmt.where(Asset.company_id == company_id)
    if allowed_domains is not None:
        stmt = stmt.where(Asset.asset_domain.in_(allowed_domains))
    if domain is not None and (allowed_domains is None or domain in allowed_domains):
        stmt = stmt.where(Asset.asset_domain == domain)
    if status is not None:
        stmt = stmt.where(Asset.status == status)
    if category_id is not None:
        stmt = stmt.where(Asset.category_id == category_id)
    if asset_user_id is not None:
        stmt = stmt.where(Asset.current_asset_user_id == asset_user_id)
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(or_(
            Asset.asset_code.ilike(pattern), Asset.legacy_asset_code.ilike(pattern),
            Asset.serial_number.ilike(pattern), Asset.po_number.ilike(pattern),
            Asset.invoice_number.ilike(pattern), Asset.pi_number.ilike(pattern),
            # AM-11: a real operator is more likely to remember an asset's
            # description ("the Dell laptop") than its generated code --
            # found missing during the Phase-1 gap review's search check.
            Asset.description.ilike(pattern),
            # AM-21: rounds the register's own search box out to every
            # remaining free-text identifier column an operator might scan
            # or type -- barcode/model were the ones still missing. Brand
            # was here too until it became a master FK (brand_id) --
            # dropped from free-text search for the same reason
            # category_id/vendor_id never were, matching this file's own
            # SORTABLE_COLUMNS comment above.
            Asset.barcode.ilike(pattern), Asset.model.ilike(pattern),
        ))

    # COUNT(*) in the database over the same filtered query, rather than
    # materialising every matching row just to len() it -- at the spec's
    # 20,000-asset target that was loading the whole register on every page view.
    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    total = (await session.execute(count_stmt)).scalar_one()

    order_column = SORTABLE_COLUMNS.get(sort_by) if sort_by else None
    if order_column is not None:
        # Asset.id as a tiebreaker keeps paging stable when many rows share
        # the sorted column's value (e.g. sorting by Status), instead of
        # page 2 silently re-showing/skipping rows page 1 already had.
        order = (order_column.desc(), Asset.id.desc()) if sort_dir == "desc" else (order_column.asc(), Asset.id.desc())
    else:
        order = (Asset.id.desc(),)
    page_stmt = stmt.order_by(*order).limit(limit).offset(offset)
    items = (await session.execute(page_stmt)).scalars().all()
    return items, total
