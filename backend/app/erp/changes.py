"""When the ERP changes a purchase order that CKAM made from it.

A CKAM PO made from an ERP PO is a copy. The ERP is loaded daily and keeps no edit history, so CKAM
remembers what the ERP said when the PO was made (or when its changes were last looked at) and shows
what is different NOW: the PO cancelled, a quantity reduced or raised, a rate or tax edited, a line
added. Nothing is changed by itself: each difference is shown with what applying it would do, and a
person applies it, or keeps the PO as it is. Delivered units (real assets) are never touched.

Units are matched by the ERP item code stored on each line (`erp_item_code`); lines typed by hand have
none and are ignored here."""
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.asset_users.models import AssetUser
from app.assets.service import compute_tax
from app.bundles.models import Bundle, BundlePart
from app.bundles.service import add_bundle_lines, split_amounts
from app.core.deps import allowed_asset_domains, scoped_company_ids, work_area_words
from app.erp.service import derive_tax, linked_vendors, untracked_codes
from app.erp.source import ErpPo, ErpSource
from app.masters.models import AssetCategory, Vendor
from app.purchase_orders.models import PendingAsset, PurchaseOrder, PurchaseOrderErpBaseline, PurchaseOrderErpChange
from app.purchase_orders.service import add_pending_asset_line, cancel_pending_asset_line, po_visible_clause

RATE_TOLERANCE = 0.005


def _cancelled(status: str | None) -> bool:
    return (status or "").strip().upper().startswith("CANCEL")


def _closed(status: str | None) -> bool:
    return (status or "").strip().upper().startswith("CLOS")


def _units(qty: float) -> int:
    return int(qty) if qty > 0 else 0


def erp_now(po: ErpPo, untracked: frozenset[str] | set[str] = frozenset()) -> dict[str, dict]:
    """What the ERP says now, per item code (upper-case): units after cancellations, rate, tax %. Codes CKAM
    does not track (`untracked`, upper-case) are left out: they are never lines here, so they are never a change."""
    derived, _ = derive_tax(po)
    out: dict[str, dict] = {}
    for ln in po.lines:
        code = (ln.item_code or "").strip().upper()
        if not code or code in untracked:
            continue
        units = _units(ln.qty - ln.cancelled_qty)
        tax = ln.tax_percent if ln.tax_percent is not None else (derived if derived is not None else 0.0)
        entry = out.get(code)
        if entry is None:
            out[code] = {"qty": units, "rate": ln.rate, "tax": tax, "description": ln.description}
        else:
            entry["qty"] += units
            if entry["qty"] == units and units > 0:        # the first line that actually has units sets the rate
                entry["rate"], entry["tax"] = ln.rate, tax
    return out


async def snapshot_baseline(session: AsyncSession, po: PurchaseOrder, erp: ErpPo, untracked: frozenset[str] | set[str] = frozenset()) -> None:
    """Remembers what the ERP says now as the state CKAM agrees with (replacing any earlier one)."""
    for row in (await session.execute(
        select(PurchaseOrderErpBaseline).where(PurchaseOrderErpBaseline.purchase_order_id == po.id)
    )).scalars().all():
        await session.delete(row)
    await session.flush()
    for code, now in erp_now(erp, untracked).items():
        session.add(PurchaseOrderErpBaseline(purchase_order_id=po.id, item_code=code, qty=now["qty"], rate=now["rate"], tax_percent=now["tax"]))
    _stamp_header(po, erp)
    await session.flush()


def _stamp_header(po: PurchaseOrder, erp: ErpPo, fields: tuple[str, ...] = ("status", "supplier", "location")) -> None:
    """Remembers what the ERP says about the PO header as agreed. Dealing with one header difference (the
    status, the vendor, the delivery location) must not hide another, so each can be stamped alone."""
    if "status" in fields:
        po.erp_status = erp.status
    if "supplier" in fields:
        po.erp_supplier_code = erp.supplier_code
    if "location" in fields:
        po.erp_delivery_location = erp.delivery_location
    po.erp_synced_at = datetime.now(timezone.utc)


async def _lines(session: AsyncSession, po_id: int) -> list[PendingAsset]:
    return list((await session.execute(
        select(PendingAsset).where(PendingAsset.purchase_order_id == po_id).order_by(PendingAsset.id)
    )).scalars().all())


def _ckam_groups(lines: list[PendingAsset]) -> dict[str, dict]:
    """Per ERP item code: units here (a bundle's parts are one unit each), how many are still pending,
    how many delivered, and the pending lines."""
    groups: dict[str, dict[str, dict]] = defaultdict(dict)
    for ln in lines:
        code = (ln.erp_item_code or "").strip().upper()
        if not code or ln.status == "CANCELLED":
            continue
        g = groups[code].setdefault(ln.description, {"total": 0, "pending": 0, "delivered": 0, "pending_lines": [], "lines": []})
        g["total"] += 1
        g["lines"].append(ln)
        if ln.status == "PENDING":
            g["pending"] += 1
            g["pending_lines"].append(ln)
        elif ln.status == "DELIVERED":
            g["delivered"] += 1
    return {
        code: {
            "parts": parts,
            "units": max(g["total"] for g in parts.values()),
            "pending": max(g["pending"] for g in parts.values()),
            "delivered": max(g["delivered"] for g in parts.values()),
            "description": next(iter(parts)),
        }
        for code, parts in groups.items()
    }


def compute_changes(po: PurchaseOrder, erp: ErpPo | None, baseline: dict[str, PurchaseOrderErpBaseline], lines: list[PendingAsset],
                    vendors_by_code: dict[str, Vendor] | None = None, untracked: frozenset[str] | set[str] = frozenset()) -> dict:
    """`vendors_by_code`: the CKAM vendors linked to this PO's company's ERP suppliers, by supplier code
    (see app.erp.service.linked_vendors); it tells whether a vendor the ERP moved the PO to is known here.
    `untracked`: ERP codes (upper case) CKAM does not track; they are ignored on both sides, so marking a
    code "not tracked" after a PO was made never shows up as that line being cancelled."""
    baseline = {code: row for code, row in baseline.items() if code not in untracked}
    report: dict = {
        "found": erp is not None, "watching": po.erp_synced_at is not None, "erp_status": erp.status if erp else None,
        "erp_as_of": erp.loaded_at.isoformat() if erp and erp.loaded_at else None, "changes": [], "info": [],
    }
    if erp is None:
        report["info"].append("The ERP no longer has this purchase order.")
        return report
    if not report["watching"]:
        return report                       # no baseline yet: nothing can be said to have changed

    groups = _ckam_groups(lines)
    now = erp_now(erp, untracked)
    pending_total = sum(g["pending"] for g in groups.values())
    delivered_total = sum(g["delivered"] for g in groups.values())

    if _cancelled(erp.status) and not _cancelled(po.erp_status):
        report["changes"].append({
            "id": "PO_CANCELLED", "kind": "PO_CANCELLED", "item_code": None, "pending_units": pending_total,
            "delivered_units": delivered_total,
            "message": "This purchase order was cancelled in the ERP.",
        })
    elif not _cancelled(po.erp_status):
        for code in sorted(set(now) | set(baseline)):
            was = baseline.get(code)
            nw = now.get(code)
            was_qty = _units(float(was.qty)) if was else 0
            now_qty = nw["qty"] if nw else 0
            g = groups.get(code)
            description = (nw or {}).get("description") or (g["description"] if g else code)
            if was is None:
                if now_qty > 0:
                    report["changes"].append({"id": f"NEW_ITEM:{code}", "kind": "NEW_ITEM", "item_code": code, "description": description,
                                              "qty": now_qty, "rate": nw["rate"]})
                continue
            if now_qty < was_qty:
                over = max(0, (g["delivered"] if g else 0) - now_qty)
                report["changes"].append({
                    "id": f"CANCEL_UNITS:{code}", "kind": "CANCEL_UNITS", "item_code": code, "description": description,
                    "was_units": was_qty, "erp_units": now_qty, "pending_units": g["pending"] if g else 0,
                    "delivered_units": g["delivered"] if g else 0,
                    "count": min(g["pending"] if g else 0, was_qty - now_qty), "over_delivered": over,
                })
            elif now_qty > was_qty:
                report["changes"].append({
                    "id": f"ADD_UNITS:{code}", "kind": "ADD_UNITS", "item_code": code, "description": description,
                    "was_units": was_qty, "erp_units": now_qty, "count": now_qty - was_qty, "can_add": g is not None,
                })
            if nw and was_qty > 0 and now_qty > 0:
                tax_changed = (was.tax_percent is not None and nw["tax"] is not None and abs(float(was.tax_percent) - nw["tax"]) > RATE_TOLERANCE)
                if abs(float(was.rate) - nw["rate"]) > RATE_TOLERANCE or tax_changed:
                    pending = g["pending"] if g else 0
                    change = {
                        "id": f"COST_CHANGED:{code}", "kind": "COST_CHANGED", "item_code": code, "description": description,
                        "was_rate": float(was.rate), "now_rate": nw["rate"], "was_tax": float(was.tax_percent) if was.tax_percent is not None else None,
                        "now_tax": nw["tax"], "pending_units": pending, "delivered_units": g["delivered"] if g else 0,
                    }
                    report["changes"].append(change)

    # header facts that are information, not something to apply to lines
    if erp.status != po.erp_status and not _cancelled(erp.status):
        if _closed(erp.status):
            report["info"].append("The ERP now shows this purchase order as closed (fully received there). Nothing to change here.")
        else:
            report["info"].append(f"The ERP status changed from {po.erp_status or 'unknown'} to {erp.status}.")
    if po.erp_supplier_code and erp.supplier_code != po.erp_supplier_code and not _cancelled(erp.status):
        linked = (vendors_by_code or {}).get(erp.supplier_code)
        report["changes"].append({
            "id": "VENDOR_CHANGED", "kind": "VENDOR_CHANGED", "item_code": None, "was_vendor": po.erp_supplier_code,
            "now_code": erp.supplier_code, "now_name": erp.supplier_name,
            "linked_vendor_id": linked.id if linked else None, "linked_vendor_name": linked.name if linked else None,
            "message": f"The ERP now shows a different vendor ({erp.supplier_name}).",
        })
    if po.erp_delivery_location and (erp.delivery_location or "") != po.erp_delivery_location:
        report["info"].append(f"The ERP now shows a different delivery location ({erp.delivery_location}).")
    if report["info"]:
        report["changes"].append({"id": "HEADER", "kind": "HEADER", "item_code": None, "messages": list(report["info"])})
        report["info"] = []
    return report


# ---- S0 leftover: the work area on a PO that mixes IT and Non-IT lines ----
# Someone limited to one work area sees only the per-item differences that
# concern units of their own area (and the PO-level ones), and may apply or
# keep only differences whose units are all in their area.

class OutsideWorkArea(PermissionError):
    """Applying this difference would change units outside the caller's work area (answered as 403)."""


async def _line_areas(session: AsyncSession, lines: list[PendingAsset]) -> dict[int, str | None]:
    missing = {ln.category_id for ln in lines if not ln.asset_domain}
    categories = dict((await session.execute(
        select(AssetCategory.id, AssetCategory.asset_domain).where(AssetCategory.id.in_(missing))
    )).all()) if missing else {}
    return {ln.id: ln.asset_domain or categories.get(ln.category_id) for ln in lines}


def _code_areas(lines: list[PendingAsset], areas: dict[int, str | None]) -> dict[str, set[str]]:
    out: dict[str, set[str]] = defaultdict(set)
    for ln in lines:
        code = (ln.erp_item_code or "").strip().upper()
        if code and ln.status != "CANCELLED" and areas.get(ln.id):
            out[code].add(areas[ln.id])
    return out


def _only_my_area(report: dict, code_areas: dict[str, set[str]], domains: tuple[str, ...] | None) -> dict:
    """Drops the per-item differences whose units are all outside `domains`."""
    if domains is None:
        return report
    report["changes"] = [
        c for c in report["changes"]
        if not (c.get("item_code") and code_areas.get(c["item_code"]) and not (code_areas[c["item_code"]] & set(domains)))
    ]
    return report


def _outside_message(outside: set[str]) -> str:
    words = " and ".join(sorted(work_area_words(a) for a in outside))
    return (f"This change also affects {words} items of this purchase order, which are outside your work area. "
            "Ask someone who handles both, or the head-office admin.")


async def _baseline(session: AsyncSession, po_id: int) -> dict[str, PurchaseOrderErpBaseline]:
    rows = (await session.execute(select(PurchaseOrderErpBaseline).where(PurchaseOrderErpBaseline.purchase_order_id == po_id))).scalars().all()
    return {r.item_code.upper(): r for r in rows}


async def _log(session: AsyncSession, po_id: int, actor: AssetUser, kind: str, item_code: str | None, summary: str) -> None:
    session.add(PurchaseOrderErpChange(purchase_order_id=po_id, actor_id=actor.id, kind=kind, item_code=item_code, summary=summary[:500]))


async def po_changes(session: AsyncSession, source: ErpSource, po: PurchaseOrder,
                     domains: tuple[str, ...] | None = None) -> dict:
    """`domains`: the caller's work area (None = both); differences that only
    concern units of the other area are left out."""
    erp = await source.po(po.erp_po_code) if po.erp_po_code is not None else None
    untracked = await untracked_codes(session, source, po.company_id, [erp] if erp else [])
    lines = await _lines(session, po.id)
    report = compute_changes(po, erp, await _baseline(session, po.id), lines,
                             await linked_vendors(session, po.company_id), untracked)
    if domains is not None:
        _only_my_area(report, _code_areas(lines, await _line_areas(session, lines)), domains)
    report.update({"po_id": po.id, "po_number": po.po_number, "erp_po_code": po.erp_po_code})
    log_rows = (await session.execute(
        select(PurchaseOrderErpChange).where(PurchaseOrderErpChange.purchase_order_id == po.id)
        .order_by(PurchaseOrderErpChange.id.desc()).limit(15)
    )).scalars().all()
    names = {u.id: u.name for u in (await session.execute(
        select(AssetUser).where(AssetUser.id.in_({r.actor_id for r in log_rows if r.actor_id}))
    )).scalars().all()} if log_rows else {}
    report["log"] = [
        {"at": r.created_at.isoformat(), "by": names.get(r.actor_id), "kind": r.kind, "item_code": r.item_code, "summary": r.summary}
        for r in log_rows
    ]
    return report


async def changes_summary(session: AsyncSession, actor: AssetUser, source: ErpSource) -> list[dict]:
    """POs made from the ERP that are still being watched and still have units pending, with how many
    differences the ERP now shows. One ERP read for all of them. S0 leftover:
    someone limited to one work area sees only the POs they may see, and only
    the differences that concern their own area's units."""
    allowed = await scoped_company_ids(session, actor)
    domains = await allowed_asset_domains(session, actor)
    stmt = select(PurchaseOrder).where(
        PurchaseOrder.erp_po_code.is_not(None), PurchaseOrder.erp_synced_at.is_not(None), PurchaseOrder.is_active.is_(True))
    if allowed is not None:
        stmt = stmt.where(PurchaseOrder.company_id.in_(allowed))
    if domains is not None:
        stmt = stmt.where(po_visible_clause(domains))
    pos = list((await session.execute(stmt)).scalars().all())
    if not pos:
        return []
    pending_po_ids = set((await session.execute(
        select(PendingAsset.purchase_order_id).where(PendingAsset.purchase_order_id.in_([p.id for p in pos]), PendingAsset.status == "PENDING")
    )).scalars().all())
    pos = [p for p in pos if p.id in pending_po_ids]
    if not pos:
        return []
    erp_by_code = {e.po_code: e for e in await source.pos_with_lines([p.erp_po_code for p in pos])}
    vendors_by_company: dict[int, dict] = {}
    untracked_by_company: dict[int, set[str]] = {}
    out = []
    for p in pos:
        if p.company_id not in vendors_by_company:
            vendors_by_company[p.company_id] = await linked_vendors(session, p.company_id)
            company_pos = [erp_by_code[q.erp_po_code] for q in pos if q.company_id == p.company_id and q.erp_po_code in erp_by_code]
            untracked_by_company[p.company_id] = await untracked_codes(session, source, p.company_id, company_pos)
        lines = await _lines(session, p.id)
        report = compute_changes(p, erp_by_code.get(p.erp_po_code), await _baseline(session, p.id), lines,
                                 vendors_by_company[p.company_id], untracked_by_company[p.company_id])
        if domains is not None:
            _only_my_area(report, _code_areas(lines, await _line_areas(session, lines)), domains)
        if report["changes"]:
            out.append({
                "po_id": p.id, "po_number": p.po_number, "changes": len(report["changes"]),
                "cancelled": any(c["kind"] == "PO_CANCELLED" for c in report["changes"]),
            })
    return out


# ---- applying -----------------------------------------------------------

async def _cancel_units(session: AsyncSession, actor: AssetUser, group: dict, count: int) -> int:
    """Cancels `count` pending units (the most recently added first). A bundle's parts each lose `count`."""
    cancelled = 0
    for part in group["parts"].values():
        for ln in sorted(part["pending_lines"], key=lambda l: l.id, reverse=True)[:count]:
            await cancel_pending_asset_line(session, ln, actor)
        cancelled = max(cancelled, min(count, len(part["pending_lines"])))
    return cancelled


async def _add_units(session: AsyncSession, actor: AssetUser, po: PurchaseOrder, group: dict, count: int, rate: float, tax: float) -> None:
    first_part = next(iter(group["parts"].values()))
    template = first_part["lines"][-1]
    if template.bundle_label:
        bundle = (await session.execute(
            select(Bundle).where(Bundle.name == template.bundle_label, Bundle.is_active.is_(True))
        )).scalars().first()
        if bundle is None:
            raise ValueError(f"The bundle {template.bundle_label!r} is not available any more, so the extra units cannot be added automatically. Add them with + Add Bundle.")
        # S2.4: the extra units join each part's existing PO line.
        line_nos = {
            description.rsplit(" - ", 1)[-1]: part["lines"][-1].line_no
            for description, part in group["parts"].items() if part["lines"][-1].line_no is not None
        }
        await add_bundle_lines(session, po, {
            "bundle_id": bundle.id, "description": template.description.rsplit(" - ", 1)[0], "barcode": template.barcode or template.erp_item_code or "",
            "quantity": count, "price": rate, "tax_percent": tax, "warranty_years": template.warranty_years or 0,
            "erp_item_code": template.erp_item_code, "line_nos": line_nos,
        }, actor)
        return
    if len(group["parts"]) != 1:
        raise ValueError("These lines have been split by hand, so the extra units cannot be added automatically. Add them with + Add Line.")
    await add_pending_asset_line(session, po, {
        "description": template.description, "barcode": template.barcode, "category_id": template.category_id,
        "subcategory_id": template.subcategory_id, "brand_id": template.brand_id, "model": template.model,
        "warranty_years": template.warranty_years or 0, "purchase_cost": rate, "tax_percent": tax, "quantity": count,
        "item_id": template.item_id, "erp_item_code": template.erp_item_code,
        "line_no": template.line_no,   # S2.4: more units of the same PO line
    }, actor)


async def _update_cost(session: AsyncSession, group: dict, rate: float, tax: float) -> int:
    """The pending units get the ERP's rate and tax %. A bundle's price is split over its parts by the
    bundle's shares, as when it was added. Delivered units keep the cost they were delivered with."""
    pending = [ln for part in group["parts"].values() for ln in part["pending_lines"]]
    if not pending:
        return 0
    bundle_label = pending[0].bundle_label
    if bundle_label:
        bundle = (await session.execute(select(Bundle).where(Bundle.name == bundle_label, Bundle.is_active.is_(True)))).scalars().first()
        parts = (await session.execute(
            select(BundlePart).where(BundlePart.bundle_id == bundle.id, BundlePart.is_active.is_(True)).order_by(BundlePart.sort_order, BundlePart.id)
        )).scalars().all() if bundle else []
        amounts = dict(zip([p.name for p in parts], split_amounts(Decimal(str(rate)), [Decimal(str(p.share_percent)) for p in parts]))) if parts else {}
        for ln in pending:
            part_name = ln.description.rsplit(" - ", 1)[-1]
            if part_name not in amounts:
                raise ValueError("The parts of this bundle have changed, so the new rate cannot be split automatically. Edit the lines by hand.")
        for ln in pending:
            _set_cost(ln, float(amounts[ln.description.rsplit(" - ", 1)[-1]]), tax)
    else:
        for ln in pending:
            _set_cost(ln, rate, tax)
    return len(pending)


def _set_cost(line: PendingAsset, cost: float, tax: float) -> None:
    line.purchase_cost = cost
    line.tax_percent = tax
    line.tax_amount, line.total_cost = compute_tax(cost, tax)


async def _set_baseline_item(session: AsyncSession, po: PurchaseOrder, code: str, now: dict | None, parts: str = "all") -> None:
    """Records the ERP's state for one item code as agreed. `parts`: "qty" (a quantity change was dealt
    with), "cost" (a rate / tax change was dealt with) or "all", so dealing with one leaves the other showing."""
    row = (await session.execute(select(PurchaseOrderErpBaseline).where(
        PurchaseOrderErpBaseline.purchase_order_id == po.id, PurchaseOrderErpBaseline.item_code == code))).scalar_one_or_none()
    if row is None:
        row = PurchaseOrderErpBaseline(purchase_order_id=po.id, item_code=code, qty=0, rate=now["rate"] if now else 0,
                                       tax_percent=now["tax"] if now else None)
        session.add(row)
    if parts in ("qty", "all"):
        row.qty = now["qty"] if now else 0
    if parts in ("cost", "all") and now:
        row.rate, row.tax_percent = now["rate"], now["tax"]


async def apply_changes(session: AsyncSession, actor: AssetUser, source: ErpSource, po: PurchaseOrder, items: list[dict],
                        domains: tuple[str, ...] | None = None) -> dict:
    """`items`: [{"id": <change id from the report>, "mode": "apply" | "keep"}], or [{"id": "WATCH", "mode": "apply"}]
    to start watching a PO that has no baseline yet. The ERP is read again first, and only changes that are
    still there can be applied. "keep" leaves the PO as it is and remembers the ERP's new state as agreed.
    `domains` (the caller's work area; None = both): a difference whose units are not all in that area is
    refused (OutsideWorkArea), as is applying the ERP's cancellation while units of the other area still
    wait -- units outside the caller's work area are never changed."""
    erp = await source.po(po.erp_po_code) if po.erp_po_code is not None else None
    if erp is None:
        raise ValueError("The ERP no longer has this purchase order, so there is nothing to compare with.")
    untracked = await untracked_codes(session, source, po.company_id, [erp])
    if any(i["id"] == "WATCH" for i in items):
        await snapshot_baseline(session, po, erp, untracked)
        await _log(session, po.id, actor, "WATCH", None, "Started comparing this purchase order with the ERP.")
        return await po_changes(session, source, po, domains)

    lines = await _lines(session, po.id)
    groups = _ckam_groups(lines)
    now = erp_now(erp, untracked)
    vendors = await linked_vendors(session, po.company_id)
    report = compute_changes(po, erp, await _baseline(session, po.id), lines, vendors, untracked)
    current = {c["id"]: c for c in report["changes"]}
    if domains is not None:
        areas = await _line_areas(session, lines)
        code_areas = _code_areas(lines, areas)
        for item in items:
            change = current.get(item["id"])
            if change is None:
                continue
            code = change.get("item_code")
            if code:
                outside = code_areas.get(code, set()) - set(domains)
            elif change["kind"] == "PO_CANCELLED" and item["mode"] == "apply":
                outside = {areas[ln.id] for ln in lines if ln.status == "PENDING" and areas.get(ln.id)} - set(domains)
            else:
                outside = set()
            if outside:
                raise OutsideWorkArea(_outside_message(outside))
    for item in items:
        change = current.get(item["id"])
        if change is None:
            raise ValueError("That change is not there any more (the ERP data or this PO has changed). Reload and look again.")
        mode, code, kind = item["mode"], change.get("item_code"), change["kind"]
        if mode not in ("apply", "keep"):
            raise ValueError("mode must be apply or keep")

        if mode == "keep":
            summary = {
                "PO_CANCELLED": "Kept this purchase order as it is although the ERP cancelled it.",
                "HEADER": "Noted the ERP's header changes without changing anything here.",
                "VENDOR_CHANGED": f"Kept the vendor as it is although the ERP now shows {erp.supplier_name}.",
                "NEW_ITEM": f"Noted {code}, new in the ERP, as dealt with.",
            }.get(kind, f"Kept {code} as it is although the ERP changed it.")
        elif kind == "PO_CANCELLED":
            n = 0
            for g in groups.values():
                n += await _cancel_units(session, actor, g, g["pending"])
            summary = f"The ERP cancelled this purchase order: cancelled {n} pending unit{'s' if n != 1 else ''} here."
        elif kind == "CANCEL_UNITS":
            n = await _cancel_units(session, actor, groups[code], change["count"]) if change["count"] else 0
            summary = f"The ERP reduced {code} from {change['was_units']} to {change['erp_units']}: cancelled {n} pending unit{'s' if n != 1 else ''}."
        elif kind == "ADD_UNITS":
            if not change["can_add"]:
                raise ValueError(f"{code} has no lines here to copy, so add the extra units with + Add Line.")
            await _add_units(session, actor, po, groups[code], change["count"], now[code]["rate"], now[code]["tax"])
            summary = f"The ERP raised {code} from {change['was_units']} to {change['erp_units']}: added {change['count']} unit{'s' if change['count'] != 1 else ''}."
        elif kind == "COST_CHANGED":
            n = await _update_cost(session, groups[code], now[code]["rate"], now[code]["tax"]) if code in groups else 0
            summary = f"The ERP changed the cost of {code} to {now[code]['rate']:g} + {now[code]['tax']:g}% tax: updated {n} pending unit{'s' if n != 1 else ''}."
        elif kind == "NEW_ITEM":
            raise ValueError(f"{code} is new in the ERP: add it with + Add Line (or + Add Bundle), then choose Keep here.")
        elif kind == "HEADER":
            summary = "Noted the ERP's header changes."
        elif kind == "VENDOR_CHANGED":
            new_vendor = vendors.get(erp.supplier_code)
            if new_vendor is None:
                raise ValueError("The new vendor is not linked to a CKAM vendor yet. Link it in Setup > Vendors, then apply.")
            po.vendor_id = new_vendor.id            # units already delivered keep the vendor they were delivered with
            summary = f"The ERP moved this purchase order to {erp.supplier_name}: the vendor is now {new_vendor.name}."
        else:
            raise ValueError(f"unknown change {kind}")

        # what the ERP says about this item / header is now the state CKAM agrees with
        if kind == "PO_CANCELLED":
            known = set(now) | set(await _baseline(session, po.id))
            for c in known:
                await _set_baseline_item(session, po, c, now.get(c))
        elif code:
            await _set_baseline_item(session, po, code, now.get(code), "cost" if kind == "COST_CHANGED" else "all" if kind == "NEW_ITEM" else "qty")
        if kind == "PO_CANCELLED":
            _stamp_header(po, erp)
        elif kind == "HEADER":
            _stamp_header(po, erp, ("status", "location"))
        elif kind == "VENDOR_CHANGED":
            _stamp_header(po, erp, ("supplier",))
        await _log(session, po.id, actor, f"{mode.upper()}_{kind}", code, summary)
    await session.flush()
    return await po_changes(session, source, po, domains)
