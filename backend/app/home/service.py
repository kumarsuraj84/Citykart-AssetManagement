"""S6: the numbers Home and the set-up guide need, each from ONE call.

* `setup_status` -- the seven set-up steps of the "Set up CKAM" guide (the same rules the frontend used to
  compute from eight list endpoints), all counts from a single SELECT of scalar sub-queries.
* `home_attention` -- the "Needs attention" counters. CKAM's own figures come from two aggregate queries
  (one over assets, one over waiting PO units), scoped by the caller's companies and work area exactly like
  the dashboard. The ERP figures (changed POs, goods arrived, ERP POs needing input, the head-office inbox)
  reuse the existing ERP functions unchanged -- they compare CKAM with its copy of the ERP data and cannot
  be a single SQL aggregate; `include_erp=false` leaves them out.
"""
from __future__ import annotations

from sqlalchemy import distinct, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.asset_users.models import AssetUser
from app.assets.models import Asset
from app.core.deps import allowed_asset_domains, is_self_service, scoped_company_ids
from app.erp.source import ErpSource, ErpUnavailable, is_configured
from app.items.models import Item
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Location, Vendor
from app.numbering.models import CodeRule
from app.purchase_orders.models import PendingAsset, PurchaseOrder
from app.purchase_orders.service import line_area_of

GONE_STATUSES = ("DISPOSED", "SOLD", "SCRAPPED", "LOST")

SETUP_STEPS = (
    ("company", "Company"),
    ("stock-room", "Stock Room / Places"),
    ("cost-centre", "Cost Centre"),
    ("catalogue", "Asset Groups and first Items"),
    ("vendors", "Vendors"),
    ("people", "People / Stores"),
    ("code-format", "Asset Code Format"),
)


# ------------------------------------------------------------------ set-up status

def _count(model, *conditions, company_ids: list[int] | None = None, company_column=None):
    stmt = select(func.count()).select_from(model).where(model.is_active.is_(True), *conditions)
    if company_ids is not None and company_column is not None:
        stmt = stmt.where(company_column.in_(company_ids))
    return stmt.scalar_subquery()


async def setup_status(session: AsyncSession, actor) -> dict:
    allowed = await scoped_company_ids(session, actor)           # None for an ADMIN / the head-office admin

    def people(kind: str):
        return _count(AssetUser, AssetUser.asset_user_type == kind, AssetUser.is_primary_owner.is_(False),
                      company_ids=allowed, company_column=AssetUser.company_id)

    row = (await session.execute(select(
        _count(Company, company_ids=allowed, company_column=Company.id).label("company_count"),
        _count(Location, company_ids=allowed, company_column=Location.company_id).label("place_count"),
        people("STOCK_POINT").label("stock_room_count"),
        _count(CostCenter, company_ids=allowed, company_column=CostCenter.company_id).label("cost_centre_count"),
        _count(AssetCategory).label("category_count"),
        _count(AssetSubcategory).label("subcategory_count"),
        _count(Item).label("item_count"),
        _count(Vendor).label("vendor_count"),
        people("EMPLOYEE").label("people_count"),
        people("STORE").label("store_count"),
        exists().where(CodeRule.is_active.is_(True)).label("code_rule_configured"),
    ))).one()
    counts = dict(row._mapping)
    done = {
        "company": counts["company_count"] > 0,
        "stock-room": counts["place_count"] > 0 and counts["stock_room_count"] > 0,
        "cost-centre": counts["cost_centre_count"] > 0,
        "catalogue": counts["category_count"] > 0 and counts["item_count"] > 0,
        "vendors": counts["vendor_count"] > 0,
        "people": counts["people_count"] + counts["store_count"] > 0,
        "code-format": bool(counts["code_rule_configured"]),
    }
    steps = [{"key": key, "label": label, "done": done[key]} for key, label in SETUP_STEPS]
    return {**counts, "code_rule_configured": bool(counts["code_rule_configured"]), "steps": steps,
            "done_count": sum(s["done"] for s in steps), "total_steps": len(steps)}


# ---------------------------------------------------------------- Home attention

async def _asset_figures(session: AsyncSession, allowed, domains, work_area) -> dict:
    """One aggregate over the caller's live assets."""
    stmt = select(
        func.count().filter(Asset.serial_pending.is_(True), Asset.status.notin_(GONE_STATUSES)),
        func.count().filter(Asset.status == "UNDER_REPAIR"),
        func.count().filter(Asset.status == "LOST"),
        func.count().filter(Asset.item_id.is_(None)),
    ).select_from(Asset).where(Asset.deleted_at.is_(None))
    if allowed is not None:
        stmt = stmt.where(Asset.company_id.in_(allowed))
    if domains is not None:
        stmt = stmt.where(Asset.asset_domain.in_(domains))
    if work_area is not None:
        stmt = stmt.where(Asset.asset_domain == work_area)
    serial_pending, under_repair, lost, unlinked = (await session.execute(stmt)).one()
    return {"serial_pending": serial_pending, "under_repair": under_repair, "lost": lost, "unlinked": unlinked}


async def _po_figures(session: AsyncSession, allowed, domains, work_area) -> tuple[int, int]:
    """One aggregate over waiting units of the caller's work area on live POs: (POs, units)."""
    area = line_area_of()
    stmt = (
        select(func.count(distinct(PendingAsset.purchase_order_id)), func.count(PendingAsset.id))
        .select_from(PendingAsset)
        .join(PurchaseOrder, PurchaseOrder.id == PendingAsset.purchase_order_id)
        .join(AssetCategory, AssetCategory.id == PendingAsset.category_id)
        .where(PendingAsset.status == "PENDING", PurchaseOrder.is_active.is_(True))
    )
    if allowed is not None:
        stmt = stmt.where(PurchaseOrder.company_id.in_(allowed))
    if domains is not None:
        stmt = stmt.where(area.in_(domains))
    if work_area is not None:
        stmt = stmt.where(area == work_area)
    pos, units = (await session.execute(stmt)).one()
    return pos, units


async def _erp_figures(session: AsyncSession, actor, source: ErpSource) -> dict:
    """The existing ERP functions, unchanged (the same numbers as /erp/changes/summary, /erp/reminders and
    /erp/pos?envelope=true). Any ERP read problem -> available false and no numbers."""
    from app.erp.changes import changes_summary
    from app.erp.reminders import delivery_reminders
    from app.erp.service import erp_po_rows
    try:
        changed = len(await changes_summary(session, actor, source))
        arrived = len(await delivery_reminders(session, actor, source))
        needing = sum(1 for r in await erp_po_rows(session, actor, source) if r["readiness"] == "NEEDS_INPUT")
    except ErpUnavailable:
        return {"erp_available": False, "erp_changed_pos": None, "erp_arrived_pos": None, "erp_pos_needing_input": None}
    return {"erp_available": True, "erp_changed_pos": changed, "erp_arrived_pos": arrived, "erp_pos_needing_input": needing}


async def home_attention(
    session: AsyncSession, actor, source: ErpSource, *, work_area: str | None = None, include_erp: bool = True,
) -> dict:
    allowed = None if is_self_service(actor) else await scoped_company_ids(session, actor)
    domains = await allowed_asset_domains(session, actor)
    if work_area is not None and domains is not None and work_area not in domains:
        work_area = None            # a narrowing outside the caller's area is ignored (never a widening)
    can_work = actor.role in ("ADMIN", "OPERATOR")
    is_admin = actor.role == "ADMIN"
    head_office = bool(getattr(actor, "is_primary_owner", False))

    assets = await _asset_figures(session, allowed, domains, work_area)
    out = {
        "work_area": work_area,
        "serial_pending": assets["serial_pending"],
        "under_repair": assets["under_repair"],
        "lost": assets["lost"],
        "unlinked_assets": assets["unlinked"] if is_admin else None,
        "waiting_pos": None, "waiting_units": None,
        "erp_available": False, "erp_changed_pos": None, "erp_arrived_pos": None, "erp_pos_needing_input": None,
        "inbox": None,
    }
    if can_work:
        out["waiting_pos"], out["waiting_units"] = await _po_figures(session, allowed, domains, work_area)
    if include_erp and can_work and is_configured():
        out.update(await _erp_figures(session, actor, source))
        if head_office and out["erp_available"]:
            from app.erp.inbox import inbox_counts
            try:
                out["inbox"] = await inbox_counts(session, source, None)
            except ErpUnavailable:
                out["inbox"] = None
    return out
