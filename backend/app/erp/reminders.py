"""Delivery reminders: the ERP says goods were received against a PO that was
created from it, but CKAM still has units pending. Only a reminder -- delivering
needs serial numbers, so it is always done by a person in Mark Delivery Done."""
from collections import defaultdict
from datetime import date
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.asset_users.models import AssetUser
from app.core.deps import scoped_company_ids
from app.erp.source import ErpSource
from app.masters.models import Vendor
from app.purchase_orders.models import PendingAsset, PurchaseOrder


def _item_label(description: str, bundle_label: str | None) -> str:
    """A bundle's lines are "<description> - <part>"; the ERP item is the whole
    bundle, so show it once under its own description."""
    if bundle_label and " - " in description:
        return f"{description.rsplit(' - ', 1)[0]} ({bundle_label})"
    return description


async def delivery_reminders(
    session: AsyncSession, actor: AssetUser, source: ErpSource, po_id: int | None = None,
) -> list[dict]:
    allowed = await scoped_company_ids(session, actor)
    stmt = select(PurchaseOrder).where(PurchaseOrder.erp_po_code.is_not(None), PurchaseOrder.is_active.is_(True))
    if po_id is not None:
        stmt = stmt.where(PurchaseOrder.id == po_id)
    if allowed is not None:
        stmt = stmt.where(PurchaseOrder.company_id.in_(allowed))
    pos = {p.id: p for p in (await session.execute(stmt)).scalars().all()}
    if not pos:
        return []
    lines = (await session.execute(
        select(PendingAsset).where(PendingAsset.purchase_order_id.in_(list(pos)), PendingAsset.status != "CANCELLED")
    )).scalars().all()

    # Per PO and item code (the barcode we stored from the ERP item code): for
    # each description (a bundle has one per part) how many lines, how many
    # delivered; the item's delivered units = the most delivered of any part.
    groups: dict[tuple[int, str], dict[str, dict]] = defaultdict(dict)
    for ln in lines:
        key = (ln.purchase_order_id, (ln.barcode or "").strip().lower())
        g = groups[key].setdefault(ln.description, {"total": 0, "delivered": 0, "label": _item_label(ln.description, ln.bundle_label)})
        g["total"] += 1
        if ln.status == "DELIVERED":
            g["delivered"] += 1
    open_pos = {po_id_ for (po_id_, _), parts in groups.items() if any(g["delivered"] < g["total"] for g in parts.values())}
    if not open_pos:
        return []

    receipts = await source.receipts([pos[i].erp_po_code for i in open_pos])
    received: dict[tuple[int, str], dict] = {}
    by_code = {pos[i].erp_po_code: i for i in open_pos}
    for r in receipts:
        pid = by_code.get(r.po_code)
        if pid is None:
            continue
        entry = received.setdefault((pid, r.item_code.strip().lower()), {"qty": 0.0, "last": None, "grc": []})
        entry["qty"] += r.received_qty
        if r.grc_date and (entry["last"] is None or r.grc_date > entry["last"]):
            entry["last"] = r.grc_date
        if r.grc_no and r.grc_no not in entry["grc"]:
            entry["grc"].append(r.grc_no)

    vendors = {v.id: v.name for v in (await session.execute(select(Vendor))).scalars().all()}
    out: dict[int, dict] = {}
    for (pid, code), parts in groups.items():
        rec = received.get((pid, code))
        if rec is None or pid not in open_pos:
            continue
        delivered = max(g["delivered"] for g in parts.values())
        ordered = max(g["total"] for g in parts.values())
        pending = ordered - delivered
        received_units = int(rec["qty"])
        to_deliver = min(received_units - delivered, pending)
        if to_deliver <= 0:
            continue
        po = pos[pid]
        entry = out.setdefault(pid, {
            "po_id": pid, "po_number": po.po_number, "vendor_name": vendors.get(po.vendor_id), "items": [], "to_deliver": 0,
            "last_received": None,
        })
        first = next(iter(parts.values()))
        entry["items"].append({
            "item_code": code.upper(), "description": first["label"], "erp_received": received_units,
            "delivered": delivered, "ordered": ordered, "to_deliver": to_deliver,
            "last_received": rec["last"].isoformat() if isinstance(rec["last"], date) else None, "grc_numbers": rec["grc"],
        })
        entry["to_deliver"] += to_deliver
        if rec["last"] and (entry["last_received"] is None or rec["last"].isoformat() > entry["last_received"]):
            entry["last_received"] = rec["last"].isoformat()
    return sorted(out.values(), key=lambda e: e["last_received"] or "", reverse=True)
