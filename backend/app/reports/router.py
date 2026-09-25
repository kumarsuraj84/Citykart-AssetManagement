from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status  # aliased: export_assets has a `status` query param
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from app.assets.custom_field_values import applicable_custom_fields
from app.assets.models import Asset, AssetFieldChange
from app.assets.search_service import search_assets
from app.core.db import get_session
from app.core.deps import STAFF_ROLES, get_current_holder, require_role, scoped_company_ids
from app.holders.models import Holder
from app.lifecycle.models import AssetEvent
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Location, Vendor
from app.reports.dashboard_service import dashboard_data
from app.reports.export_service import assets_to_xlsx, field_changes_to_xlsx, movements_to_xlsx
from app.reports.schemas import DashboardOut

router = APIRouter(prefix="/api/reports", tags=["reports"])

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# Safety cap on the asset-register Excel export, sized well above the spec's
# 20,000-asset design target (§8). An export that would exceed it is refused with a
# 422 telling the user to filter -- never silently truncated (the previous hidden
# limit of 10,000 rows quietly dropped everything past it).
EXPORT_MAX_ROWS = 50_000


async def _export_label_maps(session: AsyncSession) -> dict:
    """Batch id->name lookups for the asset-register export -- every master
    table involved is small (hundreds of rows at most), so one query per
    table beats a per-row join or a per-row point lookup at up to
    EXPORT_MAX_ROWS assets. Never scoped by company: a label map is just
    "what does id N mean", not a security boundary -- `items` (the assets
    actually being exported) is what's already company-scoped."""
    companies = {c.id: c.name for c in (await session.execute(select(Company))).scalars().all()}
    cost_centers = {c.id: c.name for c in (await session.execute(select(CostCenter))).scalars().all()}
    categories = {c.id: c.name for c in (await session.execute(select(AssetCategory))).scalars().all()}
    subcategories = {c.id: c.name for c in (await session.execute(select(AssetSubcategory))).scalars().all()}
    vendors = {v.id: v.name for v in (await session.execute(select(Vendor))).scalars().all()}
    locations = {loc.id: loc.name for loc in (await session.execute(select(Location))).scalars().all()}
    holders: dict[int, dict] = {}
    for h in (await session.execute(select(Holder))).scalars().all():
        holders[h.id] = {"name": h.name, "holder_type": h.holder_type, "location_name": locations.get(h.location_id)}
    return {
        "company": companies, "cost_center": cost_centers, "category": categories,
        "subcategory": subcategories, "vendor": vendors, "holder": holders,
    }


async def _export_custom_field_keys(session: AsyncSession, items: list[Asset]) -> list[str]:
    """AM-06 §21: the exported Custom Field columns are the union of (a) every
    active field applicable (Global + own company) to any company actually
    represented among the exported assets, and (b) every field_key that
    literally appears in any exported asset's stored `custom_fields` --
    (b) is what keeps a retired/rescoped-away definition's already-recorded
    value from being silently dropped just because it's no longer "active"
    or "applicable" today. Alphabetically sorted for a deterministic column
    order run to run."""
    keys: set[str] = set()
    company_ids = {a.company_id for a in items}
    for company_id in company_ids:
        keys.update((await applicable_custom_fields(session, company_id)).keys())
    for a in items:
        keys.update(a.custom_fields.keys())
    return sorted(keys)


@router.get("/dashboard", response_model=DashboardOut)
async def dashboard(
    session: AsyncSession = Depends(get_session),
    holder=Depends(require_role(*STAFF_ROLES)),
):
    """Staff only: a HOLDER sees only the assets they hold (spec §6), never
    company-wide KPIs/alerts, so they get 403 here. Scoped exactly like the asset
    register (Task 19): `scoped_company_ids` returns None for ADMIN (unrestricted,
    sees every company combined) and the caller's own company id otherwise, so a
    non-ADMIN never sees another company's KPI numbers."""
    allowed = scoped_company_ids(holder)
    include_purchase_orders = holder.role in ("ADMIN", "IT_TEAM")
    return await dashboard_data(session, allowed, include_purchase_orders)


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
    items, total = await search_assets(
        session, allowed, status, category_id, holder_id, company_id, q, limit=EXPORT_MAX_ROWS, offset=0,
    )
    if total > EXPORT_MAX_ROWS:
        # Refuse loudly rather than hand back a silently truncated register.
        raise HTTPException(
            http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"This export would contain {total} assets, more than the {EXPORT_MAX_ROWS}-row limit; "
            "narrow it with filters (status, category, holder, company, search).",
        )
    labels = await _export_label_maps(session)
    custom_field_keys = await _export_custom_field_keys(session, items)
    return Response(
        content=assets_to_xlsx(items, labels, custom_field_keys),
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": "attachment; filename=asset_register.xlsx"},
    )


@router.get("/export/movements")
async def export_movements(
    from_date: date = Query(...),
    to_date: date = Query(...),
    session: AsyncSession = Depends(get_session),
    holder=Depends(require_role(*STAFF_ROLES)),
):
    """Staff only (403 for a HOLDER): the log names every holder in the company, and a
    HOLDER may only see their own currently-held assets (spec §6). Company-scoped the
    same way as the dashboard (`scoped_company_ids`): a non-ADMIN role only ever gets
    movement rows for assets in their own company, ADMIN is unrestricted. Joins in the
    asset code and the from/to holder names so the exported "Asset Code"/"From Holder"/
    "To Holder" columns hold what they say, not raw internal ids."""
    from_holder = aliased(Holder)
    to_holder = aliased(Holder)
    # COALESCE to the point-in-time snapshot first (AM-01) -- falls back to today's live
    # holder name only for rows recorded before the snapshot column existed, same rule
    # as lifecycle/router.py::_with_labels applies to the in-app timeline.
    from_name = func.coalesce(AssetEvent.from_holder_name_snapshot, from_holder.name)
    to_name = func.coalesce(AssetEvent.to_holder_name_snapshot, to_holder.name)
    stmt = (
        select(AssetEvent, Asset.asset_code, from_name, to_name)
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


@router.get("/export/field-changes")
async def export_field_changes(
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    session: AsyncSession = Depends(get_session),
    holder=Depends(require_role(*STAFF_ROLES)),
):
    """AM-06 §22/§25: the field-change audit (`asset_field_change`, AM-04's
    append-only edit trail) gets its own export -- a separate canonical
    dataset from both the asset register (current snapshot) and the
    movement log (`asset_event`), never flattened into either (see
    docs/ai/DECISIONS.md). Staff only (HOLDER gets 403, same as the
    movement log -- the audit names every actor in the company, and a
    HOLDER may only see their own currently-held assets per spec §6),
    company-scoped the same way as every other report here."""
    actor = aliased(Holder)
    stmt = (
        select(AssetFieldChange, Asset.asset_code, actor.name)
        .join(Asset, Asset.id == AssetFieldChange.asset_id)
        .outerjoin(actor, actor.id == AssetFieldChange.actor_id)
        .order_by(AssetFieldChange.created_at, AssetFieldChange.id)
    )
    allowed = scoped_company_ids(holder)
    if allowed is not None:
        stmt = stmt.where(Asset.company_id.in_(allowed))
    if from_date is not None:
        stmt = stmt.where(AssetFieldChange.created_at >= from_date)
    if to_date is not None:
        stmt = stmt.where(AssetFieldChange.created_at < to_date + timedelta(days=1))
    rows = (await session.execute(stmt)).all()
    return Response(
        content=field_changes_to_xlsx(rows),
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": "attachment; filename=field_change_audit.xlsx"},
    )
