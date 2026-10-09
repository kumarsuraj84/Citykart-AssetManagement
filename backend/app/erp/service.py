"""Turns an ERP purchase order into a reviewable CKAM draft, and creates the PO
from the reviewed draft. Nothing is guessed silently: whatever cannot be
matched with confidence is left empty with a warning for the review screen."""
import re
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.asset_users.models import AssetUser
from app.bundles.models import Bundle
from app.bundles.service import add_bundle_lines
from app.core.deps import ensure_company_in_scope, scoped_company_ids
from app.erp.models import ItemCatalog
from app.erp.source import ErpPo, ErpSource
from app.masters.models import Brand, Company, CostCenter, Vendor
from app.purchase_orders.models import PurchaseOrder
from app.purchase_orders.service import add_pending_asset_line, create_purchase_order

STANDARD_TAX_SLABS = (0, 5, 12, 18, 28)
MAX_PLAUSIBLE_TAX_PERCENT = 35
COUNTABLE_UNITS = {"pcs", "pc", "nos", "no", "unit", "units", "set", "sets", "box", "roll", "ea", "each"}


def _norm(text: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def _whole(n: float) -> int | float:
    return int(n) if float(n).is_integer() else n


def split_location(po: ErpPo) -> tuple[str, str]:
    """('CKSPL-WH-TAJNAGAR', company 'CKSPL') -> warehouse code as printed and
    the part after the company prefix ('WH-TAJNAGAR'). A store code ('SVP')
    has no prefix and is returned unchanged."""
    location = (po.delivery_location or "").strip()
    prefix = f"{po.company_code}-".lower()
    short = location[len(prefix):] if po.company_code and location.lower().startswith(prefix) else location
    return location, short


def derive_tax(po: ErpPo) -> tuple[float | None, float]:
    """Tax % for lines where the ERP left it blank: the PO's total charges
    against the sum of its line amounts, snapped to the nearest GST slab when
    close. Returns (percent | None when it cannot be worked out, raw percent)."""
    base = sum(l.line_net for l in po.lines)
    if base <= 0 or po.header_net <= base:
        return None, 0.0
    # The PO's net total is the lines plus tax (checked on the real data: 1.18 x
    # the lines on every blank-tax PO). The ERP's own "charges" figure is not
    # used: on those POs it simply repeats the line total.
    raw = (po.header_net - base) / base * 100
    if raw > MAX_PLAUSIBLE_TAX_PERCENT:
        return None, raw
    slab = min(STANDARD_TAX_SLABS, key=lambda s: abs(s - raw))
    return (float(slab) if abs(slab - raw) <= 0.6 else round(raw, 2)), raw


async def _match_company(session, po: ErpPo, allowed: list[int] | None, warnings: list[str]):
    companies = (await session.execute(select(Company).where(Company.is_active.is_(True)))).scalars().all()
    company = next((c for c in companies if c.code.lower() == (po.company_code or "").lower()), None)
    if company is None:
        warnings.append(f"No company with the code {po.company_code} exists here. Choose the company.")
        return None
    if allowed is not None and company.id not in allowed:
        warnings.append(f"You do not have access to {company.name}, so this PO cannot be created by you.")
        return None
    return company


async def _match_cost_center(session, company, warnings: list[str]):
    if company is None:
        return None
    centers = (await session.execute(
        select(CostCenter).where(CostCenter.company_id == company.id, CostCenter.is_active.is_(True))
    )).scalars().all()
    wanted = {_norm(company.code), _norm(company.name)}
    hits = [c for c in centers if _norm(c.code) in wanted or _norm(c.name) in wanted]
    if len(hits) == 1:
        return hits[0]
    warnings.append(f"No single cost centre named {company.code} was found for {company.name}. Choose the cost centre.")
    return None


async def _match_delivery(session, company, warehouse_code: str, warehouse: str, warnings: list[str]):
    """Returns (asset_user_id | None, candidates). The same location on an
    earlier PO of this company wins (the user's own earlier choice); otherwise
    the company's stock points are searched for the warehouse's name."""
    if company is None or not warehouse:
        return None, []
    earlier = (await session.execute(
        select(PurchaseOrder.delivery_asset_user_id)
        .where(PurchaseOrder.company_id == company.id,
               func.lower(PurchaseOrder.warehouse_code) == warehouse_code.lower(),
               PurchaseOrder.delivery_asset_user_id.is_not(None))
        .order_by(PurchaseOrder.id.desc()).limit(1)
    )).scalar_one_or_none()
    if earlier is not None:
        user = await session.get(AssetUser, earlier)
        if user is not None and user.is_active:
            return user.id, [{"id": user.id, "name": user.name}]
    stock_points = (await session.execute(
        select(AssetUser).where(
            AssetUser.company_id == company.id, AssetUser.asset_user_type == "STOCK_POINT",
            AssetUser.is_active.is_(True),
        )
    )).scalars().all()
    tokens = [_norm(t) for t in warehouse.split("-") if _norm(t) not in ("", "wh")]
    hits = [u for u in stock_points if tokens and all(t in _norm(u.name) or t in _norm(u.code) for t in tokens)]
    candidates = [{"id": u.id, "name": u.name} for u in hits]
    if len(hits) == 1:
        return hits[0].id, candidates
    if hits:
        warnings.append(f"Several stock points match the delivery location {warehouse}. Choose the delivery location.")
    else:
        warnings.append(f"No stock point matches the delivery location {warehouse} for {company.name}. Choose the delivery location.")
    return None, candidates


async def linked_vendors(session: AsyncSession) -> dict[str, Vendor]:
    """Active CKAM vendors that are linked to an ERP supplier, by ERP code."""
    rows = (await session.execute(
        select(Vendor).where(Vendor.is_active.is_(True), Vendor.erp_vendor_code.is_not(None))
    )).scalars().all()
    return {v.erp_vendor_code: v for v in rows}


async def list_available_pos(session: AsyncSession, actor: AssetUser, source: ErpSource) -> list[dict]:
    """OPEN ERP POs of linked vendors that have not been created in CKAM yet."""
    vendors = await linked_vendors(session)
    if not vendors:
        return []
    pos = await source.open_pos(list(vendors))
    created = set((await session.execute(
        select(PurchaseOrder.erp_po_code).where(PurchaseOrder.erp_po_code.is_not(None))
    )).scalars().all())
    return [
        {
            "po_code": p.po_code, "po_number": p.po_number, "po_date": p.po_date.isoformat(),
            "company_code": p.company_code, "delivery_location": p.delivery_location,
            "vendor_id": vendors[p.supplier_code].id, "vendor_name": vendors[p.supplier_code].name,
            "line_count": p.line_count, "net_amount": p.header_net,
        }
        for p in pos if p.po_code not in created and p.supplier_code in vendors
    ]


async def build_draft(session: AsyncSession, actor: AssetUser, po: ErpPo) -> dict:
    allowed = await scoped_company_ids(session, actor)
    warnings: list[str] = []
    company = await _match_company(session, po, allowed, warnings)
    cost_center = await _match_cost_center(session, company, warnings)
    vendor = (await linked_vendors(session)).get(po.supplier_code)
    if vendor is None:
        warnings.append(f"The vendor {po.supplier_name} is not linked to a CKAM vendor. Add or link it in Vendors first.")
    warehouse_code, warehouse = split_location(po)
    delivery_id, candidates = await _match_delivery(session, company, warehouse_code, warehouse, warnings)

    existing = (await session.execute(
        select(PurchaseOrder.id).where(PurchaseOrder.erp_po_code == po.po_code).limit(1)
    )).scalar_one_or_none()
    if existing is not None:
        warnings.append(f"Purchase order {po.po_number} was already created here; it cannot be created again.")
    if po.status != "OPEN":
        warnings.append(f"This purchase order is {po.status.lower()} in the ERP.")

    brands = (await session.execute(select(Brand).where(Brand.is_active.is_(True)))).scalars().all()
    bundles = (await session.execute(select(Bundle).where(Bundle.is_active.is_(True)))).scalars().all()
    catalog = (await session.execute(select(ItemCatalog))).scalars().all()
    by_code = {c.item_code.lower(): c for c in catalog}
    derived_tax, raw_tax = derive_tax(po)

    lines = []
    for ln in po.lines:
        line_warnings: list[str] = []
        qty = ln.qty - ln.cancelled_qty
        if qty <= 0:
            continue
        if not float(qty).is_integer():
            line_warnings.append(f"The ordered quantity {qty:g} is not a whole number; it was rounded down. Check it.")
            qty = int(qty)
        if ln.unit and ln.unit.strip().lower() not in COUNTABLE_UNITS:
            line_warnings.append(f"The ERP counts this item in {ln.unit.strip()}, not pieces. Check the quantity.")
        if ln.received_qty > 0:
            line_warnings.append(f"The ERP already shows {ln.received_qty:g} received against this line.")
        if ln.tax_percent is not None:
            tax = ln.tax_percent
        elif derived_tax is not None:
            tax = derived_tax
            line_warnings.append(f"The ERP has no tax % for this line; {tax:g}% was worked out from the PO's tax total. Check it.")
        else:
            tax = 0
            line_warnings.append("The ERP has no tax % for this line and it could not be worked out. Enter it.")
        memory = by_code.get(ln.item_code.lower())
        category_id = subcategory_id = brand_id = bundle_id = model = None
        category_from_group = False
        warranty = 0
        if memory is not None:
            category_id, subcategory_id, brand_id = memory.category_id, memory.subcategory_id, memory.brand_id
            model, bundle_id = memory.model, memory.bundle_id
            warranty = memory.warranty_years or 0
        else:
            same_group = next((c for c in reversed(catalog) if ln.group_code and c.group_code == ln.group_code and c.category_id), None)
            if same_group is not None:
                category_id, subcategory_id, category_from_group = same_group.category_id, same_group.subcategory_id, True
            words = set(re.findall(r"[a-z0-9]+", ln.description.lower()))
            brand_hits = [b for b in brands if _norm(b.name) and set(re.findall(r"[a-z0-9]+", b.name.lower())) <= words]
            if len(brand_hits) == 1:
                brand_id = brand_hits[0].id
            bundle_hits = [b for b in bundles if set(re.findall(r"[a-z0-9]+", b.name.lower())) <= words]
            if len(bundle_hits) == 1:
                bundle_id = bundle_hits[0].id
        lines.append({
            "item_code": ln.item_code, "description": ln.description[:500], "barcode": ln.item_code,
            "quantity": _whole(qty), "rate": ln.rate, "amount": round(ln.rate * qty, 2), "tax_percent": tax,
            "hsn": ln.hsn, "unit": ln.unit, "group_code": ln.group_code, "warranty_years": warranty,
            "category_id": category_id, "subcategory_id": subcategory_id, "brand_id": brand_id,
            "model": model, "bundle_id": bundle_id, "remembered": memory is not None,
            "category_from_group": category_from_group, "warnings": line_warnings,
        })

    return {
        "erp_po_code": po.po_code, "po_number": po.po_number, "po_date": po.po_date.isoformat(),
        "company_id": company.id if company else None, "company_code": po.company_code, "company_name": po.company_name,
        "cost_center_id": cost_center.id if cost_center else None,
        "vendor_id": vendor.id if vendor else None, "vendor_name": po.supplier_name,
        "warehouse_code": warehouse_code, "warehouse": warehouse,
        "delivery_asset_user_id": delivery_id, "delivery_candidates": candidates,
        "already_created_id": existing, "status": po.status, "warnings": warnings, "lines": lines,
    }


async def create_from_draft(session: AsyncSession, actor: AssetUser, data: dict) -> dict:
    """Creates the PO and all its lines in one go (bundles expanded), or
    nothing at all. Raises ValueError with a message for the user."""
    await ensure_company_in_scope(session, actor, data["company_id"])
    number = data["po_number"].strip()
    if not number:
        raise ValueError("PO number is required")
    if data.get("erp_po_code") is not None:
        done = (await session.execute(
            select(PurchaseOrder.id).where(PurchaseOrder.erp_po_code == data["erp_po_code"]).limit(1)
        )).scalar_one_or_none()
        if done is not None:
            raise ValueError(f"purchase order {number} was already created here")
    existing = (await session.execute(
        select(PurchaseOrder.id).where(
            PurchaseOrder.company_id == data["company_id"], func.lower(PurchaseOrder.po_number) == number.lower(),
            PurchaseOrder.is_active.is_(True),
        ).limit(1)
    )).scalar_one_or_none()
    if existing is not None:
        raise ValueError(f"purchase order {number} already exists for this company")
    if not data["lines"]:
        raise ValueError("a purchase order needs at least one line")

    po = await create_purchase_order(session, {
        "company_id": data["company_id"], "po_number": number, "po_date": data["po_date"],
        "vendor_id": data.get("vendor_id"), "cost_center_id": data["cost_center_id"],
        "delivery_asset_user_id": data.get("delivery_asset_user_id"), "warehouse_code": data.get("warehouse_code"),
        "erp_po_code": data.get("erp_po_code"),
    }, actor)

    created = 0
    for position, ln in enumerate(data["lines"], start=1):
        label = f"line {position} ({ln['item_code'] or ln['description'][:30]})"
        if not ln["barcode"].strip():
            raise ValueError(f"{label}: barcode is required")
        if ln["rate"] <= 0:
            raise ValueError(f"{label}: cost must be more than 0")
        if ln.get("bundle_id"):
            lines = await add_bundle_lines(session, po, {
                "bundle_id": ln["bundle_id"], "description": ln["description"], "barcode": ln["barcode"],
                "quantity": ln["quantity"], "price": ln["rate"], "tax_percent": ln["tax_percent"],
                "warranty_years": ln["warranty_years"], "parts": ln.get("bundle_parts"),
            }, actor)
        else:
            if not ln.get("category_id") or not ln.get("subcategory_id"):
                raise ValueError(f"{label}: category and sub-category are required")
            lines = await add_pending_asset_line(session, po, {
                "description": ln["description"], "barcode": ln["barcode"], "category_id": ln["category_id"],
                "subcategory_id": ln["subcategory_id"], "brand_id": ln.get("brand_id"), "model": ln.get("model"),
                "warranty_years": ln["warranty_years"], "purchase_cost": ln["rate"],
                "tax_percent": ln["tax_percent"], "quantity": ln["quantity"],
            }, actor)
        created += len(lines)
        if ln.get("remember") and ln.get("item_code"):
            await _remember(session, actor, ln)
    return {"po_id": po.id, "po_number": po.po_number, "lines_created": created}


async def _remember(session: AsyncSession, actor: AssetUser, ln: dict) -> None:
    entry = (await session.execute(
        select(ItemCatalog).where(func.lower(ItemCatalog.item_code) == ln["item_code"].lower())
    )).scalar_one_or_none()
    if entry is None:
        entry = ItemCatalog(item_code=ln["item_code"], created_by=actor.id)
        session.add(entry)
    entry.group_code = ln.get("group_code") or entry.group_code
    entry.bundle_id = ln.get("bundle_id")
    entry.category_id = None if ln.get("bundle_id") else ln.get("category_id")
    entry.subcategory_id = None if ln.get("bundle_id") else ln.get("subcategory_id")
    entry.brand_id = ln.get("brand_id")
    entry.model = ln.get("model") or None
    entry.warranty_years = ln.get("warranty_years")
    entry.updated_by = actor.id
    await session.flush()
