from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status  # aliased: export_assets has a `status` query param
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased
from app.assets.custom_field_values import applicable_custom_fields
from app.assets.models import Asset, AssetFieldChange
from app.assets.search_service import build_asset_query, search_assets
from app.core.db import get_session
from app.core.deps import (
    READ_ROLES, WRITE_ROLES, allowed_asset_domains, get_current_asset_user, is_self_service, require_role,
    scoped_company_ids,
)
from app.core.validation import parse_work_area
from app.asset_users.models import AssetUser
from app.items.models import Item
from app.lifecycle.models import AssetEvent
from app.masters.models import AssetCategory, AssetSubcategory, Brand, Company, CostCenter, Location, Vendor
from app.reports.dashboard_service import dashboard_data
from app.reports.export_service import (
    MOVEMENT_EXPORT_COLUMNS, asset_export_columns, asset_export_row, assets_to_xlsx, field_changes_to_xlsx,
    movement_export_row, movements_to_xlsx,
)
from app.reports.schemas import DashboardOut
from app.observability import events as obs_events

router = APIRouter(prefix="/api/reports", tags=["reports"])

STATUS_WORDS = {
    "IN_STOCK": "In stock", "ALLOTTED": "Allotted", "INSTALLED": "Installed", "UNDER_REPAIR": "Under repair",
    "DISPOSED": "Disposed", "SOLD": "Sold", "SCRAPPED": "Scrapped", "LOST": "Lost",
}

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# Safety cap on the asset-register Excel export, sized well above the spec's
# 20,000-asset design target (§8). An export that would exceed it is refused with a
# 422 telling the user to filter -- never silently truncated (the previous hidden
# limit of 10,000 rows quietly dropped everything past it).
EXPORT_MAX_ROWS = 50_000

SELF_SERVICE_REPORTS = "Reports are for staff. The assets you hold are listed under My Assets."


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
    brands = {b.id: b.name for b in (await session.execute(select(Brand))).scalars().all()}
    locations = {loc.id: loc.name for loc in (await session.execute(select(Location))).scalars().all()}
    asset_users: dict[int, dict] = {}
    for h in (await session.execute(select(AssetUser))).scalars().all():
        asset_users[h.id] = {"name": h.name, "asset_user_type": h.asset_user_type, "location_name": locations.get(h.location_id)}
    return {
        "company": companies, "cost_center": cost_centers, "category": categories,
        "subcategory": subcategories, "vendor": vendors, "asset_user": asset_users, "brand": brands,
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
    domain: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
    asset_user=Depends(require_role(*READ_ROLES)),
):
    """Staff only: a SELF_SERVICE asset_user sees only the assets they hold (spec §6),
    never company-wide KPIs/alerts, so they get 403 here. Scoped exactly like the asset
    register (Task 19): `scoped_company_ids` returns None for ADMIN (unrestricted,
    sees every company combined) and the caller's own company id otherwise, so a
    non-ADMIN never sees another company's KPI numbers. `domain` is the optional "My
    Responsibility" selector (spec §37/§67) -- always further narrowed by the caller's
    own `allowed_asset_domains` server-side, never trusted to widen past it."""
    allowed = await scoped_company_ids(session, asset_user)
    domains = await allowed_asset_domains(session, asset_user)
    include_purchase_orders = asset_user.role in WRITE_ROLES
    return await dashboard_data(session, allowed, include_purchase_orders, allowed_domains=domains, domain=domain)


async def _asset_report_args(
    session: AsyncSession, asset_user, *, status, category_id, asset_user_id, company_id, q, exact, domain,
    work_area=None, item_id=None, vendor_id=None, po_number=None, holder_id=None, purchase_from=None, purchase_to=None,
) -> dict:
    """S5: the asset report's filters and scope, ONE place for the Excel export and the preview. A
    self-service login only ever sees what it holds; everyone else their companies and work area."""
    if holder_id is not None and asset_user_id is None:
        asset_user_id = holder_id
    if is_self_service(asset_user):
        # S7 (P3-9): reports are for staff, like the movement log; a self-service login has My Assets.
        raise HTTPException(http_status.HTTP_403_FORBIDDEN, SELF_SERVICE_REPORTS)
    allowed = await scoped_company_ids(session, asset_user)
    try:
        wanted_domain = parse_work_area(work_area) or domain
    except ValueError as exc:
        raise HTTPException(http_status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    if purchase_from is not None and purchase_to is not None and purchase_to < purchase_from:
        raise HTTPException(http_status.HTTP_422_UNPROCESSABLE_ENTITY, "The 'to' date cannot be before the 'from' date.")
    return {
        "allowed_company_ids": allowed, "status": status, "category_id": category_id, "asset_user_id": asset_user_id,
        "company_id": company_id, "q": q, "exact": exact, "allowed_domains": await allowed_asset_domains(session, asset_user),
        "domain": wanted_domain, "item_id": item_id, "vendor_id": vendor_id, "po_number": po_number,
        "purchase_from": purchase_from, "purchase_to": purchase_to,
    }


@router.get("/export/assets")
async def export_assets(
    status: str | None = Query(None),
    category_id: int | None = Query(None),
    asset_user_id: int | None = Query(None),
    company_id: int | None = Query(None),
    q: str | None = Query(None, max_length=200),
    exact: bool = Query(False),
    domain: str | None = Query(None),
    work_area: str | None = Query(None, max_length=10),
    item_id: int | None = Query(None),
    vendor_id: int | None = Query(None),
    po_number: str | None = Query(None, max_length=100),
    holder_id: int | None = Query(None),
    purchase_from: date | None = Query(None),
    purchase_to: date | None = Query(None),
    session: AsyncSession = Depends(get_session),
    asset_user=Depends(get_current_asset_user),
):
    """Same filters and the exact same scoping branch as `GET /api/assets`
    (`list_assets` in app.assets.router, Task 19): a ASSET_USER's `asset_user_id` is pinned to
    their own id (so they only ever export the assets they currently hold, regardless
    of any `asset_user_id`/`company_id` they pass in) and every other role is scoped by
    `scoped_company_ids` (None = ADMIN, unrestricted; otherwise just their own
    company) -- a non-ADMIN caller can never export another company's rows. `domain`
    is the optional Responsibility filter (spec §38), same as the register's own --
    always further bounded server-side by allowed_asset_domains, never a way to widen
    past it (see search_assets). S5 (additive filters, shared with the preview): `work_area`
    (= domain), `item_id`, `vendor_id`, `po_number` (whole number, any case), `holder_id`
    (= asset_user_id), `purchase_from` / `purchase_to` (purchase date, inclusive)."""
    args = await _asset_report_args(
        session, asset_user, status=status, category_id=category_id, asset_user_id=asset_user_id,
        company_id=company_id, q=q, exact=exact, domain=domain, work_area=work_area, item_id=item_id,
        vendor_id=vendor_id, po_number=po_number, holder_id=holder_id, purchase_from=purchase_from,
        purchase_to=purchase_to,
    )
    items, total = await search_assets(session, limit=EXPORT_MAX_ROWS, offset=0, **args)
    if total > EXPORT_MAX_ROWS:
        # Refuse loudly rather than hand back a silently truncated register.
        raise HTTPException(
            http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"This export would contain {total} assets, more than the {EXPORT_MAX_ROWS}-row limit; "
            "narrow it with filters (status, category, asset user, company, search).",
        )
    labels = await _export_label_maps(session)
    custom_field_keys = await _export_custom_field_keys(session, items)
    # S8: who exported the register, with which filters, how many rows.
    await obs_events.exported("the asset register", len(items), {
        "status": status, "category_id": category_id, "holder_id": asset_user_id or holder_id, "company_id": company_id,
        "q": q, "exact": exact, "work_area": work_area or domain, "item_id": item_id, "vendor_id": vendor_id,
        "po_number": po_number, "purchase_from": purchase_from, "purchase_to": purchase_to})
    return Response(
        content=assets_to_xlsx(items, labels, custom_field_keys),
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": "attachment; filename=asset_register.xlsx"},
    )


async def _movements_query(session: AsyncSession, asset_user, from_date: date, to_date: date):
    """The movement log's SELECT (S5: shared by the Excel export and the preview), ordered by date."""
    from_asset_user = aliased(AssetUser)
    to_asset_user = aliased(AssetUser)
    # COALESCE to the point-in-time snapshot first (AM-01) -- falls back to today's live
    # asset_user name only for rows recorded before the snapshot column existed, same rule
    # as lifecycle/router.py::_with_labels applies to the in-app timeline.
    from_name = func.coalesce(AssetEvent.from_asset_user_name_snapshot, from_asset_user.name)
    to_name = func.coalesce(AssetEvent.to_asset_user_name_snapshot, to_asset_user.name)
    stmt = (
        select(AssetEvent, Asset.asset_code, from_name, to_name)
        .join(Asset, Asset.id == AssetEvent.asset_id)
        .outerjoin(from_asset_user, from_asset_user.id == AssetEvent.from_asset_user_id)
        .outerjoin(to_asset_user, to_asset_user.id == AssetEvent.to_asset_user_id)
        .where(AssetEvent.event_date >= from_date, AssetEvent.event_date < to_date + timedelta(days=1))
        # S0.3: assets deleted as data-entry mistakes are not part of the log.
        .where(Asset.deleted_at.is_(None))
        .order_by(AssetEvent.event_date, AssetEvent.id)
    )
    allowed = await scoped_company_ids(session, asset_user)
    if allowed is not None:
        stmt = stmt.where(Asset.company_id.in_(allowed))
    # S0.3: and only the caller's own work area (IT / Non-IT), like the register.
    domains = await allowed_asset_domains(session, asset_user)
    if domains is not None:
        stmt = stmt.where(Asset.asset_domain.in_(domains))
    return stmt


# ---- S5: on-screen previews of the two reports (same query, same rows as the Excel files) ----

PREVIEW_MAX = 200


async def _page_export_label_maps(session: AsyncSession, items: list[Asset]) -> dict:
    """The export's id -> name maps (same shape as _export_label_maps), but only for the ids on this page --
    so the preview's rows hold exactly what the file's rows hold without loading every master."""
    async def names(model, ids) -> dict:
        wanted = {i for i in ids if i is not None}
        if not wanted:
            return {}
        return dict((await session.execute(select(model.id, model.name).where(model.id.in_(wanted)))).all())

    holder_ids = {a.current_asset_user_id for a in items}
    holders = (await session.execute(
        select(AssetUser.id, AssetUser.name, AssetUser.asset_user_type, Location.name)
        .outerjoin(Location, Location.id == AssetUser.location_id).where(AssetUser.id.in_(holder_ids))
    )).all() if holder_ids else []
    return {
        "company": await names(Company, (a.company_id for a in items)),
        "cost_center": await names(CostCenter, (a.cost_center_id for a in items)),
        "category": await names(AssetCategory, (a.category_id for a in items)),
        "subcategory": await names(AssetSubcategory, (a.subcategory_id for a in items)),
        "vendor": await names(Vendor, (a.vendor_id for a in items)),
        "brand": await names(Brand, (a.brand_id for a in items)),
        "asset_user": {hid: {"name": name, "asset_user_type": kind, "location_name": loc} for hid, name, kind, loc in holders},
    }


async def _report_custom_field_keys(session: AsyncSession, base) -> list[str]:
    """The export's custom-field columns for EVERY asset the filters match (not just one page): every active
    field applicable to a company among them, plus every key any of them holds -- same rule as
    _export_custom_field_keys, computed in the database."""
    keys: set[str] = set()
    for company_id in (await session.execute(select(base.c.company_id).distinct())).scalars().all():
        keys.update((await applicable_custom_fields(session, company_id)).keys())
    held = select(func.json_object_keys(base.c.custom_fields).label("k")).where(
        func.json_typeof(base.c.custom_fields) == "object").subquery()
    keys.update(k for k in (await session.execute(select(held.c.k).distinct())).scalars().all() if k is not None)
    return sorted(keys)


@router.get("/assets/preview")
async def preview_assets(
    status: str | None = Query(None),
    category_id: int | None = Query(None),
    work_area: str | None = Query(None, max_length=10),
    company_id: int | None = Query(None),
    item_id: int | None = Query(None),
    vendor_id: int | None = Query(None),
    po_number: str | None = Query(None, max_length=100),
    holder_id: int | None = Query(None),
    purchase_from: date | None = Query(None),
    purchase_to: date | None = Query(None),
    q: str | None = Query(None, max_length=200),
    exact: bool = Query(False),
    domain: str | None = Query(None),
    asset_user_id: int | None = Query(None),
    limit: int = Query(50, ge=1, le=PREVIEW_MAX),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
    asset_user=Depends(get_current_asset_user),
):
    """The asset register report on screen: the same filters, scope and rows as GET /export/assets
    (`columns` = the file's headings, each row a dict keyed by them, `asset_ids` in the same order), one
    page at a time, plus `total` and a `summary` (count by status, by category, top 10 Items) over
    everything the filters match."""
    args = await _asset_report_args(
        session, asset_user, status=status, category_id=category_id, asset_user_id=asset_user_id,
        company_id=company_id, q=q, exact=exact, domain=domain, work_area=work_area, item_id=item_id,
        vendor_id=vendor_id, po_number=po_number, holder_id=holder_id, purchase_from=purchase_from,
        purchase_to=purchase_to,
    )
    items, total = await search_assets(session, limit=limit, offset=offset, **args)
    base = build_asset_query(**args).subquery()
    custom_keys = await _report_custom_field_keys(session, base)
    labels = await _page_export_label_maps(session, list(items))
    count = func.count().label("count")
    by_status = (await session.execute(
        select(base.c.status, count).group_by(base.c.status).order_by(count.desc(), base.c.status)
    )).all()
    by_category = (await session.execute(
        select(base.c.category_id, AssetCategory.name, count)
        .outerjoin(AssetCategory, AssetCategory.id == base.c.category_id)
        .group_by(base.c.category_id, AssetCategory.name).order_by(count.desc(), AssetCategory.name)
    )).all()
    by_item = (await session.execute(
        select(base.c.item_id, Item.name, count)
        .outerjoin(Item, Item.id == base.c.item_id)
        .group_by(base.c.item_id, Item.name).order_by(count.desc(), Item.name).limit(10)
    )).all()
    return {
        "total": total,
        "columns": asset_export_columns(custom_keys),
        "rows": [asset_export_row(a, labels, custom_keys) for a in items],
        "asset_ids": [a.id for a in items],
        "summary": {
            "by_status": [{"status": s, "status_label": STATUS_WORDS.get(s, s), "count": n} for s, n in by_status],
            "by_category": [{"category_id": c, "category_name": name, "count": n} for c, name, n in by_category],
            "by_item": [{"item_id": i, "item_name": name, "count": n} for i, name, n in by_item],
        },
    }


@router.get("/movements/preview")
async def preview_movements(
    from_date: date = Query(...),
    to_date: date = Query(...),
    limit: int = Query(50, ge=1, le=PREVIEW_MAX),
    offset: int = Query(0, ge=0),
    session: AsyncSession = Depends(get_session),
    asset_user=Depends(require_role(*READ_ROLES)),
):
    """The movement log on screen: the same query, scope and rows as GET /export/movements, one page at a
    time (`columns` = the file's headings), plus `total`."""
    if to_date < from_date:
        raise HTTPException(http_status.HTTP_422_UNPROCESSABLE_ENTITY, "The 'to' date cannot be before the 'from' date.")
    stmt = await _movements_query(session, asset_user, from_date, to_date)
    total = (await session.execute(select(func.count()).select_from(stmt.order_by(None).subquery()))).scalar_one()
    rows = (await session.execute(stmt.limit(limit).offset(offset))).all()
    return {"total": total, "columns": MOVEMENT_EXPORT_COLUMNS, "rows": [movement_export_row(r) for r in rows]}


@router.get("/export/movements")
async def export_movements(
    from_date: date = Query(...),
    to_date: date = Query(...),
    session: AsyncSession = Depends(get_session),
    asset_user=Depends(require_role(*READ_ROLES)),
):
    """Staff only (403 for a ASSET_USER): the log names every asset_user in the company, and a
    ASSET_USER may only see their own currently-held assets (spec §6). Company-scoped the
    same way as the dashboard (`scoped_company_ids`): a non-ADMIN role only ever gets
    movement rows for assets in their own company, ADMIN is unrestricted. Joins in the
    asset code and the from/to asset_user names so the exported "Asset Code"/"From AssetUser"/
    "To AssetUser" columns hold what they say, not raw internal ids."""
    stmt = await _movements_query(session, asset_user, from_date, to_date)
    rows = (await session.execute(stmt)).all()
    await obs_events.exported("the movement log", len(rows), {"from_date": from_date, "to_date": to_date})
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
    asset_user=Depends(require_role(*READ_ROLES)),
):
    """AM-06 §22/§25: the field-change audit (`asset_field_change`, AM-04's
    append-only edit trail) gets its own export -- a separate canonical
    dataset from both the asset register (current snapshot) and the
    movement log (`asset_event`), never flattened into either (see
    docs/ai/DECISIONS.md). Staff only (ASSET_USER gets 403, same as the
    movement log -- the audit names every actor in the company, and a
    ASSET_USER may only see their own currently-held assets per spec §6),
    company-scoped the same way as every other report here."""
    actor = aliased(AssetUser)
    stmt = (
        select(AssetFieldChange, Asset.asset_code, actor.name)
        .join(Asset, Asset.id == AssetFieldChange.asset_id)
        .outerjoin(actor, actor.id == AssetFieldChange.actor_id)
        .where(Asset.deleted_at.is_(None))
        .order_by(AssetFieldChange.created_at, AssetFieldChange.id)
    )
    allowed = await scoped_company_ids(session, asset_user)
    if allowed is not None:
        stmt = stmt.where(Asset.company_id.in_(allowed))
    domains = await allowed_asset_domains(session, asset_user)
    if domains is not None:
        stmt = stmt.where(Asset.asset_domain.in_(domains))
    if from_date is not None:
        stmt = stmt.where(AssetFieldChange.created_at >= from_date)
    if to_date is not None:
        stmt = stmt.where(AssetFieldChange.created_at < to_date + timedelta(days=1))
    rows = (await session.execute(stmt)).all()
    await obs_events.exported("the field-change audit", len(rows), {"from_date": from_date, "to_date": to_date})
    return Response(
        content=field_changes_to_xlsx(rows),
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": "attachment; filename=field_change_audit.xlsx"},
    )
