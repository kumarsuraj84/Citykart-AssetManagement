"""Turns an ERP purchase order into a reviewable CKAM draft, and creates the PO
from the reviewed draft. Nothing is guessed silently: whatever cannot be
matched with confidence is left empty with a warning for the review screen."""
import re
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.asset_users.models import AssetUser
from app.bundles.models import Bundle
from app.bundles.service import add_bundle_lines
from app.core.deps import allowed_asset_domains, check_work_area, ensure_company_in_scope, scoped_company_ids
from app.erp.readiness import (
    article_names, live_lines, open_erp_pos, problems_for, resolution_of, suggested_scope,
)
from app.erp.source import ErpPo, ErpSource, ErpVendor
from app.erp.vendors import (
    _active_vendors, create_vendor_for_codes, group_key, known_gstins, link_codes, pan_of, suggest_vendors,
)
from app.items.models import Item, LEVEL_TYPES
from app.items.service import (
    _words, active_rule_sets, find_rule, norm as norm_name, resolve_items, suggest_item, upsert_map,
)
from app.masters.models import AssetCategory, AssetSubcategory, Brand, Company, CostCenter, Vendor, VendorErpLink
from app.purchase_orders.models import PurchaseOrder
from app.purchase_orders.service import add_pending_asset_line, create_purchase_order

from app.erp.tax import MAX_PLAUSIBLE_TAX_PERCENT, STANDARD_TAX_SLABS, derive_tax  # noqa: F401  (re-exported: callers import derive_tax from here)

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


async def _match_company(session, po: ErpPo, allowed: list[int] | None, warnings: list[str]):
    companies = (await session.execute(select(Company).where(Company.is_active.is_(True)))).scalars().all()
    wanted = (po.company_code or "").strip().lower()
    # the ERP company code (set on the company when it differs from its own code), else the plain code
    company = next((c for c in companies if wanted and c.erp_code.lower() == wanted), None) \
        or next((c for c in companies if wanted and c.code.lower() == wanted), None)
    if company is None:
        warnings.append(
            f"No company is set up for the ERP company {po.company_code}. In Setup > Companies, put {po.company_code} "
            "in the company's ERP company code, or choose the company here."
        )
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
    wanted = {_norm(company.code), _norm(company.erp_code), _norm(company.name)}
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


async def linked_vendors(session: AsyncSession, company_id: int) -> dict[str, Vendor]:
    """Active CKAM vendors linked to a supplier of THIS company's ERP, by that company's supplier code
    (the same code is a different supplier in the other company)."""
    rows = (await session.execute(
        select(VendorErpLink.erp_vendor_code, Vendor)
        .join(Vendor, Vendor.id == VendorErpLink.vendor_id)
        .where(VendorErpLink.company_id == company_id, Vendor.is_active.is_(True))
    )).all()
    return {code: vendor for code, vendor in rows}


async def untracked_codes(session: AsyncSession, source: ErpSource, company_id: int | None, erp_pos: list[ErpPo]) -> set[str]:
    """The ERP item codes (upper case) on these POs that CKAM does not track, by the company's rules (a code,
    its product name, its Article, Department, Section or Division marked "not tracked")."""
    codes = sorted({ln.item_code for p in erp_pos for ln in p.lines if ln.item_code})
    if not codes:
        return set()
    resolutions = await resolve_items(session, await source.items(codes), company_id)
    return {code.upper() for code, r in resolutions.items() if r.not_tracked}


async def scoped_companies(session: AsyncSession, actor: AssetUser, company_id: int | None = None) -> list[Company]:
    """The active companies this login works in (optionally just one of them)."""
    allowed = await scoped_company_ids(session, actor)
    stmt = select(Company).where(Company.is_active.is_(True)).order_by(Company.id)
    if allowed is not None:
        stmt = stmt.where(Company.id.in_(allowed))
    if company_id is not None:
        stmt = stmt.where(Company.id == company_id)
    return list((await session.execute(stmt)).scalars().all())


async def created_erp_po_codes(session: AsyncSession) -> set[int]:
    return set((await session.execute(
        select(PurchaseOrder.erp_po_code).where(PurchaseOrder.erp_po_code.is_not(None))
    )).scalars().all())


async def links_of_companies(session: AsyncSession, company_ids: list[int]) -> dict[tuple[int, str], Vendor]:
    """(company id, ERP supplier code) -> the active CKAM vendor linked to it, for several companies at once."""
    if not company_ids:
        return {}
    rows = (await session.execute(
        select(VendorErpLink.company_id, VendorErpLink.erp_vendor_code, Vendor)
        .join(Vendor, Vendor.id == VendorErpLink.vendor_id)
        .where(VendorErpLink.company_id.in_(company_ids), Vendor.is_active.is_(True))
    )).all()
    return {(cid, code): vendor for cid, code, vendor in rows}


def _index_items(erp_items: list) -> dict:
    out = {}
    for e in erp_items:
        out[e.icode] = e
        out.setdefault(e.icode.upper(), e)
    return out


async def erp_po_rows(
    session: AsyncSession, actor: AssetUser, source: ErpSource, *, q: str | None = None, company_id: int | None = None,
) -> list[dict]:
    """S3a-2: every OPEN ERP PO of the companies this login works in, of EVERY supplier (a PO of a supplier
    not matched yet is listed with the problem "Vendor needs matching.", never left out), not yet created in
    CKAM, each with its readiness. Only a PO made entirely of things CKAM does not track stays out (as
    before). One pass: the POs with their lines in one read, the ERP items in one read, the item rules and
    the vendor links once -- no query per PO or per line."""
    companies = await scoped_companies(session, actor, company_id)
    if not companies:
        return []
    by_erp: dict[str, Company] = {}
    for c in companies:
        by_erp.setdefault(c.erp_code.lower(), c)
    created = await created_erp_po_codes(session)
    links = await links_of_companies(session, [c.id for c in companies])
    pos = [p for p in await open_erp_pos(source, [c.erp_code for c in companies])
           if p.po_code not in created and (p.company_code or "").lower() in by_erp]
    codes = sorted({ln.item_code for p in pos for ln in live_lines(p) if ln.item_code})
    erp_items = _index_items(await source.items(codes)) if codes else {}
    rules = await active_rule_sets(session, [c.id for c in companies])
    needle = (q or "").strip().casefold()
    # S4: work area. A login limited to IT or Non-IT does not see an ERP PO whose lines are ALL decided
    # and all belong to the other work area (by their Items' categories). A PO with any undecided line
    # stays visible: its work area is not known until an Item is chosen.
    domains = await allowed_asset_domains(session, actor)
    resolved: list[tuple] = []
    category_ids: set[int] = set()
    for p in pos:
        company = by_erp[p.company_code.lower()]
        engine = rules[company.id]
        decisions = []
        for ln in live_lines(p):
            erp = erp_items.get(ln.item_code) or erp_items.get((ln.item_code or "").upper())
            res = engine.resolve(erp) if erp is not None else None
            decisions.append((ln, res))
            if res is not None and res.item is not None and not res.not_tracked:
                category_ids.add(res.item.category_id)
        resolved.append((p, company, decisions))
    area_of_category: dict[int, str] = {}
    if domains is not None and category_ids:
        area_of_category = dict((await session.execute(
            select(AssetCategory.id, AssetCategory.asset_domain).where(AssetCategory.id.in_(category_ids))
        )).all())
    out: list[dict] = []
    for p, company, decisions in resolved:
        live = [ln for ln, _res in decisions]
        untracked = 0
        undecided: set[str] = set()
        areas: set[str] = set()
        for ln, res in decisions:
            if res is not None and res.not_tracked:
                untracked += 1
            elif res is None or res.item is None:
                undecided.add((ln.item_code or "").upper())
            elif area_of_category.get(res.item.category_id):
                areas.add(area_of_category[res.item.category_id])
        if live and untracked == len(live):
            continue                     # nothing on it that CKAM tracks
        if domains is not None and not undecided and areas and not (areas & set(domains)):
            continue                     # every decided line belongs to the other work area
        vendor = links.get((company.id, p.supplier_code))
        problems = problems_for(vendor is not None, len(undecided))
        row = {
            "po_code": p.po_code, "po_number": p.po_number, "po_date": p.po_date.isoformat(),
            "company_id": company.id, "company_code": p.company_code, "delivery_location": p.delivery_location,
            "vendor_id": vendor.id if vendor else None, "vendor_name": vendor.name if vendor else p.supplier_name,
            "line_count": p.line_count, "net_amount": p.header_net,
            "tracked_lines": len(live) - untracked, "untracked_lines": untracked,
            # S3a-2 (additive)
            "erp_vendor_code": p.supplier_code, "erp_vendor_name": p.supplier_name, "vendor_linked": vendor is not None,
            "undecided_item_count": len(undecided), "tracked_line_count": len(live) - untracked,
            "untracked_line_count": untracked,
            "readiness": "NEEDS_INPUT" if problems else "READY", "problems": problems,
        }
        if needle and not any(needle in (text or "").casefold() for text in (p.po_number, p.supplier_name, row["vendor_name"])):
            continue
        out.append(row)
    return sorted(out, key=lambda r: (r["po_date"], r["po_code"]), reverse=True)


async def list_available_pos(session: AsyncSession, actor: AssetUser, source: ErpSource) -> list[dict]:
    """OPEN ERP POs of every company the user may work in that have not been created in CKAM yet. S3a-2:
    every supplier's (see erp_po_rows), each with its readiness."""
    return await erp_po_rows(session, actor, source)


MAX_VENDOR_SUGGESTIONS = 5


async def _vendor_context(
    session: AsyncSession, source: ErpSource, company: Company | None, po: ErpPo, vendor: Vendor | None,
    links: dict[str, Vendor],
) -> dict:
    """S3a-2: what the review needs to match an unmatched supplier in the flow: the ERP supplier itself
    (code, name, GSTIN, PAN), the CKAM vendors that may be it (GSTIN, then PAN, then name; only suggestions),
    and the supplier's other registrations in the same company (same PAN) with their link state, so all of
    them can be linked in one go. Nothing about another company's suppliers is shown when the PO's company
    is not one the user works in (company is None then)."""
    if company is None:
        return {"erp_vendor": {"code": po.supplier_code, "name": po.supplier_name, "gstin": None, "pan": None},
                "vendor_suggestions": [], "vendor_registrations": []}
    suppliers = await source.vendors(company.erp_code)
    me = next((s for s in suppliers if s.code == po.supplier_code), None) or ErpVendor(po.supplier_code, po.supplier_name)
    pan = pan_of(me.gstin)
    registrations = []
    for s in suppliers:
        if pan and s.code != me.code and pan_of(s.gstin) == pan:
            linked = links.get(s.code)
            registrations.append({
                "erp_code": s.code, "name": s.name, "gstin": s.gstin, "linked": linked is not None,
                "linked_vendor_id": linked.id if linked else None, "linked_vendor_name": linked.name if linked else None,
            })
    suggestions: list[dict] = []
    if vendor is None:
        vendors = await _active_vendors(session)
        by_id = {v.id: v for v in vendors}
        found = suggest_vendors(me, vendors, await known_gstins(session, vendors))
        sibling_ids = {r["linked_vendor_id"] for r in registrations if r["linked_vendor_id"]}
        if len(sibling_ids) == 1 and next(iter(sibling_ids)) in by_id:
            # the other registrations of this supplier are already linked to one vendor: that one first
            sibling = by_id[next(iter(sibling_ids))]
            found = [(sibling, "PAN")] + [(v, r) for v, r in found if v.id != sibling.id]
        suggestions = [{"vendor_id": v.id, "name": v.name, "gstin": v.gstin, "reason": reason}
                       for v, reason in found[:MAX_VENDOR_SUGGESTIONS]]
    return {
        "erp_vendor": {"code": me.code, "name": me.name, "gstin": me.gstin, "pan": pan,
                       "group_key": group_key(company.erp_code, me.code, me.gstin)},
        "vendor_suggestions": suggestions, "vendor_registrations": registrations,
    }


async def build_draft(session: AsyncSession, actor: AssetUser, po: ErpPo, source: ErpSource) -> dict:
    allowed = await scoped_company_ids(session, actor)
    warnings: list[str] = []
    company = await _match_company(session, po, allowed, warnings)
    cost_center = await _match_cost_center(session, company, warnings)
    links = await linked_vendors(session, company.id) if company is not None else {}
    vendor = links.get(po.supplier_code)
    if vendor is None:
        where = f" for {company.name}" if company is not None else ""
        warnings.append(f"The vendor {po.supplier_name} is not linked to a CKAM vendor{where}. "
                        "Link it to an existing vendor or create a new one.")
    vendor_context = await _vendor_context(session, source, company, po, vendor, links)
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
    derived_tax, raw_tax = derive_tax(po)
    worked_out = next((ln.tax_percent for ln in po.lines if ln.tax_derived), None)
    if worked_out is not None:
        warnings.append(f"The ERP stores no tax % on the lines of this PO; {worked_out:g}% was worked out from the PO's tax total. Check it.")
    # Which CKAM Item each ERP code is (code > product name > Article), and what
    # the ERP says about each code, so the review screen can show words next to
    # the code and ask once for any code that has no Item yet.
    erp_items = {e.icode: e for e in await source.items([ln.item_code for ln in po.lines])}
    resolutions = await resolve_items(session, list(erp_items.values()), company.id if company else None)
    cat_rows = {c.id: c for c in (await session.execute(select(AssetCategory))).scalars().all()}
    sub_rows = {s.id: s for s in (await session.execute(select(AssetSubcategory))).scalars().all()}
    bundles_by_id = {b.id: b for b in (await session.execute(select(Bundle).where(Bundle.is_active.is_(True)))).scalars().all()}
    # S3a-2: for a code that still needs an Item, a suggested Item (the same word-overlap suggestion as the
    # ERP Articles screen) and what "remember this choice" covers by default (see readiness.suggested_scope).
    active_items = list((await session.execute(select(Item).where(Item.is_active.is_(True)))).scalars().all())
    item_words = {i.id: _words(i.name) for i in active_items}
    names_by_article = await article_names(source, [e.article_key for e in erp_items.values()],
                                           company.erp_code if company else None)

    lines = []
    untracked_lines = []
    undecided: set[str] = set()
    for ln in po.lines:
        line_warnings: list[str] = []
        qty = ln.qty - ln.cancelled_qty
        if qty <= 0:
            continue
        res = resolutions.get(ln.item_code)
        if res is not None and res.not_tracked:
            # Something CKAM does not track (a cable, a hanger): it never becomes a line here.
            untracked_lines.append({
                "item_code": ln.item_code, "description": ln.description[:500], "quantity": _whole(qty), "rate": ln.rate,
                "why": res.why_not_tracked, "map_id": res.map_id, "resolution": resolution_of(res),
            })
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
        erp = erp_items.get(ln.item_code)
        item = res.item if res else None
        brand_id = warranty = None
        if item is not None:
            brand_id, warranty = item.default_brand_id, item.default_warranty_years
        if brand_id is None:
            words = set(re.findall(r"[a-z0-9]+", ln.description.lower()))
            brand_hits = [b for b in brands if _norm(b.name) and set(re.findall(r"[a-z0-9]+", b.name.lower())) <= words]
            if len(brand_hits) == 1:
                brand_id = brand_hits[0].id
        if erp is None:
            line_warnings.append("The ERP item master has no record of this code, so it cannot be matched to an Item automatically.")
        elif erp.extinct:
            line_warnings.append("The ERP marks this item (or its Article) as extinct.")
        if item is None:
            where = f" (Article {erp.article_name})" if erp else ""
            line_warnings.append(f"No Item is linked to this ERP code yet{where}. Choose the Item below; it is remembered for the next PO.")
        category = cat_rows.get(item.category_id) if item else None
        subcategory = sub_rows.get(item.subcategory_id) if item and item.subcategory_id else None
        suggestion, score = (None, 0.0)
        if item is None:
            undecided.add((ln.item_code or "").upper())
            texts = [erp.article_name, erp.department, erp.name, ln.description] if erp else [ln.description]
            suggestion, score = suggest_item(active_items, texts, item_words)
        lines.append({
            "item_code": ln.item_code, "description": ln.description[:500], "barcode": ln.item_code,
            "quantity": _whole(qty), "rate": ln.rate, "amount": round(ln.rate * qty, 2), "tax_percent": tax,
            "hsn": ln.hsn, "unit": ln.unit, "warranty_years": warranty or 0, "brand_id": brand_id, "model": None,
            "item_id": item.id if item else None, "item_name": item.name if item else None,
            "matched_by": res.matched_by if item and res else None,
            "category_id": item.category_id if item else None, "category_name": category.name if category else None,
            "subcategory_id": item.subcategory_id if item else None, "subcategory_name": subcategory.name if subcategory else None,
            "bundle_id": item.bundle_id if item else None,
            "bundle_name": bundles_by_id[item.bundle_id].name if item and item.bundle_id in bundles_by_id else None,
            "erp_description": erp.description if erp else None, "erp_name": erp.name if erp else None,
            "article_key": erp.article_key if erp else None, "article_name": erp.article_name if erp else None,
            "section": erp.section if erp else None, "department": erp.department if erp else None,
            "division": erp.division if erp else None,
            "name_key": norm_name(erp.name) if erp else None,
            "warnings": line_warnings,
            # S3a-2 (additive)
            "resolution": resolution_of(res),
            "suggested_item_id": suggestion.id if suggestion else None,
            "suggested_item_name": suggestion.name if suggestion else None,
            "suggestion_score": round(score, 2) if suggestion else None,
            "suggested_scope": suggested_scope(erp, names_by_article),
        })

    if untracked_lines and not lines:
        warnings.append("None of the lines of this purchase order are tracked in CKAM, so there is nothing to create from it.")
    problems = problems_for(vendor is not None, len(undecided))
    return {
        **vendor_context,
        "vendor": {"id": vendor.id, "name": vendor.name} if vendor else None, "vendor_linked": vendor is not None,
        "undecided_item_count": len(undecided), "readiness": "NEEDS_INPUT" if problems else "READY", "problems": problems,
        "untracked_lines": untracked_lines,
        "erp_po_code": po.po_code, "po_number": po.po_number, "po_date": po.po_date.isoformat(),
        "company_id": company.id if company else None, "company_code": po.company_code,
        "company_name": company.name if company else po.company_name,
        "cost_center_id": cost_center.id if cost_center else None,
        "vendor_id": vendor.id if vendor else None, "vendor_name": po.supplier_name,
        "warehouse_code": warehouse_code, "warehouse": warehouse,
        "delivery_asset_user_id": delivery_id, "delivery_candidates": candidates,
        "already_created_id": existing, "status": po.status, "warnings": warnings, "lines": lines,
    }


# S0.8: how far a reviewed line's cost may move from the ERP's rate for that
# item code (a rounding fix or a corrected rate is fine; 0.0001 is not).
RATE_LOW_FACTOR = 0.5
RATE_HIGH_FACTOR = 2.0


MATCH_VENDOR_FIRST = "Match the vendor first (Link to an existing vendor or Create a new one)."


async def _apply_vendor_choice(
    session: AsyncSession, actor: AssetUser, source: ErpSource, company: Company, erp_po: ErpPo,
    vendor: Vendor | None, choice: dict | None,
) -> Vendor:
    """S3a-2: matches the PO's ERP supplier in the flow, inside the PO's own transaction (if anything later
    fails, the new vendor / link is rolled back with the PO). LINK = to an existing active vendor; CREATE = a
    new vendor from the ERP supplier (name / GSTIN / contact, code made from the name); `also_link_codes` =
    other registrations of the same supplier (same PAN) in the same company, linked to the same vendor. The
    GSTIN rules of the vendor screens apply (a GSTIN already known for another vendor is refused)."""
    if vendor is None:
        if not choice:
            raise ValueError(
                f"The vendor {erp_po.supplier_name} is not linked to a CKAM vendor for {company.name}. {MATCH_VENDOR_FIRST}")
        if choice["action"] == "LINK":
            try:
                done = await link_codes(session, actor, source, choice["vendor_id"], company.id, [erp_po.supplier_code])
            except LookupError:
                raise ValueError("The vendor you chose does not exist.")
            vendor = done["vendor"]
        else:
            vendor = await create_vendor_for_codes(session, actor, source, company.id, [erp_po.supplier_code], choice.get("name"))
    elif choice and choice["action"] == "LINK" and choice.get("vendor_id") not in (None, vendor.id):
        raise ValueError(f"The ERP supplier {erp_po.supplier_name} is already matched to the vendor {vendor.name}.")
    also = [c for c in (choice or {}).get("also_link_codes") or [] if (c or "").strip() and c.strip() != erp_po.supplier_code]
    if also:
        suppliers = {s.code: s for s in await source.vendors(company.erp_code)}
        me = suppliers.get(erp_po.supplier_code)
        pan = pan_of(me.gstin) if me else None
        for code in also:
            other = suppliers.get(code.strip())
            if other is None:
                raise ValueError(f"The ERP supplier {code} was not found in the ERP of {company.name}.")
            if pan is None or pan_of(other.gstin) != pan:
                raise ValueError(f"{other.name} is not a registration of the same supplier (its PAN is different), so it is not linked here.")
        await link_codes(session, actor, source, vendor.id, company.id, [c.strip() for c in also])
    return vendor


async def _revalidate_against_erp(
    session: AsyncSession, data: dict, source: ErpSource, actor: AssetUser | None = None,
) -> tuple[ErpPo, Company, Vendor]:
    """S0.8: the reviewed draft comes from the browser, so everything that is
    the ERP's to decide is read again from CKAM's ERP copy: the ERP PO must
    exist and belong to the chosen company, the PO number and date are the
    ERP's, the vendor is the one linked to the ERP supplier, every line's
    item code is on that ERP PO, no item code asks for more units than the
    ERP has open, and a line's cost stays within half to double the ERP rate.
    Edits the reviewer may legitimately make (description, barcode, brand,
    model, tax, warranty, the Item, fewer units) are kept."""
    if data.get("erp_po_code") is None:
        raise ValueError("Choose the ERP purchase order this is created from.")
    erp_po = await source.po(data["erp_po_code"])
    if erp_po is None:
        raise ValueError("This purchase order was not found in the ERP.")
    company = await session.get(Company, data["company_id"])
    if company is None or not company.is_active:
        raise ValueError("The company you chose does not exist or is no longer active.")
    wanted = (erp_po.company_code or "").strip().lower()
    if wanted not in (company.erp_code.lower(), company.code.lower()):
        raise ValueError(f"This ERP purchase order belongs to the ERP company {erp_po.company_code}, not to {company.name}.")
    vendor = (await linked_vendors(session, company.id)).get(erp_po.supplier_code)
    if vendor is None or data.get("vendor_choice"):
        vendor = await _apply_vendor_choice(session, actor, source, company, erp_po, vendor, data.get("vendor_choice"))
    if data.get("vendor_id") is not None and data["vendor_id"] != vendor.id:
        raise ValueError(f"The vendor of this purchase order is {vendor.name} (the vendor linked to the ERP supplier); it cannot be changed here.")

    open_units: dict[str, float] = {}
    rates: dict[str, list[float]] = {}
    for ln in erp_po.lines:
        code = (ln.item_code or "").strip().upper()
        units = ln.qty - ln.cancelled_qty
        if not code or units <= 0:
            continue
        open_units[code] = open_units.get(code, 0) + units
        rates.setdefault(code, []).append(ln.rate)
    asked: dict[str, int] = {}
    for position, ln in enumerate(data["lines"], start=1):
        code = (ln.get("item_code") or "").strip().upper()
        label = f"Line {position} ({ln.get('item_code') or ln['description'][:30]})"
        if not code or code not in open_units:
            raise ValueError(f"{label}: this ERP item code is not on the ERP purchase order {erp_po.po_number}.")
        asked[code] = asked.get(code, 0) + ln["quantity"]
        erp_rates = [r for r in rates[code] if r and r > 0]
        if erp_rates and not (min(erp_rates) * RATE_LOW_FACTOR <= ln["rate"] <= max(erp_rates) * RATE_HIGH_FACTOR):
            raise ValueError(
                f"{label}: the cost {ln['rate']:g} is too far from the ERP rate {min(erp_rates):g} "
                "(it may be between half and double the ERP rate)."
            )
    for code, units in asked.items():
        allowed = int(open_units[code])
        if units > allowed:
            raise ValueError(f"{code}: {units} units asked, but the ERP purchase order has only {allowed} open.")
    return erp_po, company, vendor


async def create_from_draft(session: AsyncSession, actor: AssetUser, data: dict, source: ErpSource) -> dict:
    """Creates the PO and all its lines in one go (bundles expanded), or
    nothing at all. Raises ValueError with a message for the user.
    S0.8: re-reads the ERP purchase order first (see _revalidate_against_erp);
    S0.3: a line whose Item belongs to the other work area is refused."""
    await ensure_company_in_scope(session, actor, data["company_id"])
    erp_po, company, vendor = await _revalidate_against_erp(session, data, source, actor)
    number = erp_po.po_number.strip()
    done = (await session.execute(
        select(PurchaseOrder.id).where(PurchaseOrder.erp_po_code == erp_po.po_code).limit(1)
    )).scalar_one_or_none()
    if done is not None:
        raise ValueError(f"Purchase order {number} was already created here.")
    if not data["lines"]:
        raise ValueError("A purchase order needs at least one line.")
    domains = await allowed_asset_domains(session, actor)

    # create_purchase_order refuses a number already used in this company.
    po = await create_purchase_order(session, {
        "company_id": company.id, "po_number": number, "po_date": erp_po.po_date,
        "vendor_id": vendor.id, "cost_center_id": data["cost_center_id"],
        "delivery_asset_user_id": data.get("delivery_asset_user_id"), "warehouse_code": data.get("warehouse_code"),
        "erp_po_code": erp_po.po_code,
    }, actor)

    # S3a-2: what "remember this choice" stores is read from the ERP item master (never from the browser),
    # and when the reviewer asks to remember without naming a reach, the line's suggested reach is used.
    remembering = [ln for ln in data["lines"] if ln.get("map_scope") or ln.get("remember")]
    erp_items: dict = {}
    names_by_article: dict[str, set[str]] = {}
    if remembering:
        erp_items = _index_items(await source.items(sorted({ln["item_code"] for ln in remembering if ln.get("item_code")})))
        if any(not ln.get("map_scope") for ln in remembering):
            names_by_article = await article_names(source, [e.article_key for e in erp_items.values()], company.erp_code)

    created = 0
    line_nos: set[int] = set()
    for position, ln in enumerate(data["lines"], start=1):
        label = f"Line {position} ({ln['item_code'] or ln['description'][:30]})"
        if not ln["barcode"].strip():
            raise ValueError(f"{label}: barcode is required")
        if ln["rate"] <= 0:
            raise ValueError(f"{label}: cost must be more than 0")
        item = await session.get(Item, ln.get("item_id")) if ln.get("item_id") else None
        if item is None or not item.is_active:
            raise ValueError(f"{label}: choose the Item")
        category = await session.get(AssetCategory, item.category_id)
        check_work_area(domains, category.asset_domain if category else None, label)
        # Category, sub-category and bundle come from the Item, never from the client.
        if item.bundle_id:
            lines = await add_bundle_lines(session, po, {
                "bundle_id": item.bundle_id, "description": ln["description"], "barcode": ln["barcode"],
                "quantity": ln["quantity"], "price": ln["rate"], "tax_percent": ln["tax_percent"],
                "warranty_years": ln["warranty_years"], "parts": ln.get("bundle_parts"), "erp_item_code": ln.get("item_code"),
            }, actor, allowed_domains=domains)
        else:
            lines = await add_pending_asset_line(session, po, {
                "description": ln["description"], "barcode": ln["barcode"], "category_id": item.category_id,
                "subcategory_id": item.subcategory_id, "brand_id": ln.get("brand_id"), "model": ln.get("model"),
                "warranty_years": ln["warranty_years"], "purchase_cost": ln["rate"],
                "tax_percent": ln["tax_percent"], "quantity": ln["quantity"],
                "item_id": item.id, "erp_item_code": ln.get("item_code"),
            }, actor, allowed_domains=domains)
        created += len(lines)
        line_nos.update(unit.line_no for unit in lines)
        if ln.get("map_scope") or ln.get("remember"):
            erp = erp_items.get(ln.get("item_code") or "") or erp_items.get((ln.get("item_code") or "").upper())
            scope = ln.get("map_scope") or suggested_scope(erp, names_by_article)
            await _remember_mapping(session, actor, item, ln, company.id, scope, erp, label)
    # S4: same meaning as POST /purchase-orders/with-lines -- lines = PO line numbers made (a set counts one
    # per part), units = waiting units made. (Before S4 `lines_created` held the unit count.)
    return {"po_id": po.id, "po_number": po.po_number, "lines_created": len(line_nos), "units_created": created}


async def _remember_mapping(
    session: AsyncSession, actor: AssetUser, item: Item, ln: dict, company_id: int, scope: str, erp, label: str,
) -> None:
    """Saves the user's choice of Item as a rule for this PO's company (its ERP
    master is its own), so the next PO of that company with this code (or
    Article, or product name) needs no choosing. S3a-2: the Article / product
    name come from the ERP item master (what the browser sends is only used for
    a code the master does not know, and then only the code can be remembered);
    and someone other than the head-office admin can only ADD a decision, never
    re-point one that already exists for this company (that is rule management)."""
    if scope not in ("CODE", "NAME", "ARTICLE"):
        raise ValueError(f"unknown mapping scope {scope!r}")
    article_key = erp.article_key if erp is not None else None
    name_key = norm_name(erp.name) if erp is not None else None
    if scope != "CODE" and not article_key:
        raise ValueError(f"{label}: this code has no Article in the ERP, so it can only be remembered by its own code.")
    if scope == "NAME" and not name_key:
        raise ValueError(f"{label}: this code has no product name in the ERP; remember it for the code or the whole Article.")
    code = (ln.get("item_code") or "").strip()
    if not getattr(actor, "is_primary_owner", False):
        # the decision in force for this company: its own rule, else the every-company one
        existing = (await find_rule(session, scope, company_id, code=code, article_key=article_key, name_key=name_key)
                    or await find_rule(session, scope, None, code=code, article_key=article_key, name_key=name_key))
        holder = await session.get(Item, existing.item_id) if existing is not None and existing.item_id else None
        in_force = existing is not None and (existing.not_tracked or (holder is not None and holder.is_active))
        if in_force and (existing.not_tracked or existing.item_id != item.id):
            current = "marked not tracked" if existing.not_tracked else f"linked to {holder.name}"
            what = {"CODE": f"the ERP code {code}", "NAME": f"the product {erp.name} (Article {erp.article_name})",
                    "ARTICLE": f"the whole Article {erp.article_name if erp else article_key}"}[scope]
            way_out = ("Remember this choice for this code only, or ask the head-office admin to change it."
                       if scope != "CODE" else "Ask the head-office admin to change it.")
            raise ValueError(f"{label}: {what} is already {current}. {way_out}")
    await upsert_map(session, actor, {
        "item_id": item.id, "company_id": company_id, "match_type": scope, "article_key": article_key if erp is not None else ln.get("article_key"),
        "name_key": name_key, "erp_item_code": code or None,
        "section": erp.section if erp is not None else ln.get("section"),
        "department": erp.department if erp is not None else ln.get("department"),
        "article_name": erp.article_name if erp is not None else ln.get("article_name"),
    })


# ---- S3a-2: "not tracked" from the PO review --------------------------------------------------

LEVEL_REFUSAL = "Ask the head-office admin to mark whole departments as not tracked."


class NotAllowed(Exception):
    """A plain-words refusal the router answers with 403."""


async def company_of_erp_po(session: AsyncSession, actor: AssetUser, po: ErpPo) -> Company:
    """The CKAM company of an ERP PO, which must be one this login works in."""
    warnings: list[str] = []
    allowed = await scoped_company_ids(session, actor)
    company = await _match_company(session, po, allowed, warnings)
    if company is None:
        if any("do not have access" in w for w in warnings):
            raise NotAllowed("You can only work on purchase orders of your own company. Ask the head-office admin.")
        raise ValueError(warnings[0] if warnings else "No company is set up for this ERP purchase order.")
    return company


async def po_line_states(session: AsyncSession, source: ErpSource, po: ErpPo, company: Company) -> dict:
    """Every live line of an ERP PO with its decision now (MATCHED / NOT_TRACKED / NEEDS_ITEM), and the PO's
    readiness -- what the review shows after a decision."""
    erp_items = {e.icode: e for e in await source.items([ln.item_code for ln in po.lines if ln.item_code])}
    resolutions = await resolve_items(session, list(erp_items.values()), company.id)
    vendor = (await linked_vendors(session, company.id)).get(po.supplier_code)
    lines, undecided = [], set()
    for ln in live_lines(po):
        state = resolution_of(resolutions.get(ln.item_code))
        if state["state"] == "NEEDS_ITEM":
            undecided.add((ln.item_code or "").upper())
        lines.append({"line_key": ln.po_line_key, "item_code": ln.item_code, "description": ln.description[:500],
                      "quantity": _whole(ln.qty - ln.cancelled_qty), "resolution": state})
    problems = problems_for(vendor is not None, len(undecided))
    return {"po_code": po.po_code, "po_number": po.po_number, "lines": lines, "undecided_item_count": len(undecided),
            "vendor_linked": vendor is not None, "readiness": "NEEDS_INPUT" if problems else "READY", "problems": problems}


async def mark_not_tracked(
    session: AsyncSession, actor: AssetUser, source: ErpSource, po_code: int, icode: str, scope: str,
) -> dict:
    """S3a-2: "Not an asset" on a line of the PO review, for ADMIN / OPERATOR of the PO's company. Stores the
    same "not tracked" rule the head-office admin's screens store (app.items.service.upsert_map, actor kept),
    for this code, its product name or its Article (in the PO's company). A whole Department / Section /
    Division stays with the head-office admin, and so does changing a line that already has an Item, and
    undoing a rule (DELETE /api/items/maps/{id})."""
    po = await source.po(po_code)
    if po is None:
        raise LookupError("This purchase order was not found in the ERP.")
    company = await company_of_erp_po(session, actor, po)
    owner = bool(getattr(actor, "is_primary_owner", False))
    if scope in LEVEL_TYPES and not owner:
        raise NotAllowed(LEVEL_REFUSAL)
    wanted = (icode or "").strip().upper()
    on_po = next((ln.item_code for ln in live_lines(po) if wanted and (ln.item_code or "").upper() == wanted), None)
    if on_po is None:
        raise ValueError(f"The ERP item code {icode} is not on the purchase order {po.po_number}.")
    icode = on_po                     # the ERP's own spelling of the code
    erp = next((e for e in await source.items([icode]) if e.icode.upper() == wanted), None)
    if erp is None and scope != "CODE":
        raise ValueError("The ERP item master has no record of this code, so only this code can be marked not tracked.")
    if scope == "NAME" and not norm_name(erp.name):
        raise ValueError("This code has no product name in the ERP; mark the code or the whole Article instead.")
    current = (await resolve_items(session, [erp], company.id)).get(erp.icode) if erp is not None else None
    if current is not None and current.not_tracked:
        return await po_line_states(session, source, po, company)          # already not tracked: nothing to do
    if current is not None and current.item is not None and not owner:
        raise ValueError(f"This line is already linked to the Item {current.item.name}. Ask the head-office admin to change it.")
    level = {"DEPARTMENT": erp.department, "SECTION": erp.section, "DIVISION": erp.division}.get(scope) if erp else None
    if scope in LEVEL_TYPES and not norm_name(level):
        raise ValueError(f"This code has no {scope.title()} in the ERP.")
    await upsert_map(session, actor, {
        "match_type": scope, "not_tracked": True, "company_id": company.id,
        "erp_item_code": erp.icode if erp else icode.strip(), "article_key": erp.article_key if erp else None,
        "name_key": erp.name if erp else None, "level_key": level,
        "section": erp.section if erp else None, "department": erp.department if erp else None,
        "article_name": erp.article_name if erp else None, "note": f"Marked not tracked on PO {po.po_number}"[:300],
    })
    return await po_line_states(session, source, po, company)
