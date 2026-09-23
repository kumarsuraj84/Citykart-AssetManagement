from datetime import date, timedelta
from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from app.assets.models import Asset
from app.assets.search_service import search_assets
from app.core.db import get_session
from app.core.deps import get_current_holder, scoped_company_ids
from app.holders.models import Holder
from app.lifecycle.models import AssetEvent
from app.reports.dashboard_service import dashboard_data
from app.reports.export_service import assets_to_xlsx, movements_to_xlsx
from app.reports.schemas import DashboardOut

router = APIRouter(prefix="/api/reports", tags=["reports"])

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/dashboard", response_model=DashboardOut)
async def dashboard(
    session: AsyncSession = Depends(get_session),
    holder=Depends(get_current_holder),
):
    """Scoped exactly like the asset register (Task 19): `scoped_company_ids` returns
    None for ADMIN (unrestricted, sees every company combined) and the caller's own
    company id otherwise, so a non-ADMIN never sees another company's KPI numbers."""
    allowed = scoped_company_ids(holder)
    return await dashboard_data(session, allowed)


@router.get("/export/assets")
async def export_assets(
    status: str | None = Query(None),
    category_id: int | None = Query(None),
    holder_id: int | None = Query(None),
    company_id: int | None = Query(None),
    q: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
    holder=Depends(get_current_holder),
):
    """Same filters and the exact same scoping branch as `GET /api/assets`
    (`list_assets` in app.assets.router, Task 19): a HOLDER's `holder_id` is pinned to
    their own id (so they only ever export the assets they currently hold, regardless
    of any `holder_id`/`company_id` they pass in) and every other role is scoped by
    `scoped_company_ids` (None = ADMIN, unrestricted; otherwise just their own
    company) -- a non-ADMIN caller can never export another company's rows."""
    if holder.role == "HOLDER":
        holder_id = holder.id
        allowed = None
    else:
        allowed = scoped_company_ids(holder)
    items, _total = await search_assets(session, allowed, status, category_id, holder_id, company_id, q, limit=10000, offset=0)
    return Response(
        content=assets_to_xlsx(items),
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": "attachment; filename=asset_register.xlsx"},
    )


@router.get("/export/movements")
async def export_movements(
    from_date: date = Query(...),
    to_date: date = Query(...),
    session: AsyncSession = Depends(get_session),
    holder=Depends(get_current_holder),
):
    """Company-scoped the same way as the dashboard (`scoped_company_ids`): a HOLDER or
    other non-ADMIN role only ever gets movement rows for assets in their own company,
    ADMIN is unrestricted. Joins in the asset code and the from/to holder names so the
    exported "Asset Code"/"From Holder"/"To Holder" columns hold what they say, not raw
    internal ids."""
    from_holder = aliased(Holder)
    to_holder = aliased(Holder)
    stmt = (
        select(AssetEvent, Asset.asset_code, from_holder.name, to_holder.name)
        .join(Asset, Asset.id == AssetEvent.asset_id)
        .outerjoin(from_holder, from_holder.id == AssetEvent.from_holder_id)
        .outerjoin(to_holder, to_holder.id == AssetEvent.to_holder_id)
        .where(AssetEvent.event_date >= from_date, AssetEvent.event_date < to_date + timedelta(days=1))
        .order_by(AssetEvent.event_date, AssetEvent.id)
    )
    allowed = scoped_company_ids(holder)
    if allowed is not None:
        stmt = stmt.where(Asset.company_id.in_(allowed))
    rows = (await session.execute(stmt)).all()
    return Response(
        content=movements_to_xlsx(rows),
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": "attachment; filename=movement_log.xlsx"},
    )
