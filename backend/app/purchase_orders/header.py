"""S6: editing a purchase order's header -- vendor, cost centre, delivery place, PO date and PO number.

Rules (PUT /api/purchase-orders/{id}; only the fields the request sends are changed):
* Company scope and work area as for every PO write; a user limited to one work area may edit the header
  only when every line of the PO is in their area (the header belongs to all its lines -- same rule as
  deleting a PO). A deleted PO cannot be edited.
* Once any unit has been received, the fields the received assets carry -- vendor, cost centre, PO number
  and PO date -- are locked (the assets keep what they were received with; changing the PO would make the
  two disagree). The delivery place can always be changed.
* A PO made from the ERP keeps the ERP's PO number and date, and its vendor follows the ERP supplier (a
  supplier change is applied from the PO's ERP changes, app.erp.changes); its cost centre and delivery
  place can be changed like any PO's.
* New choices must be active and of the PO's company; the PO number stays unique per company (trimmed,
  any letter case, live POs), like on create.
* While nothing is received, a new cost centre is also given to the waiting units (they carry it to the
  asset on receipt).
* Every changed field is written to the append-only `master_audit` trail (entity "purchase_order"),
  readable names and dates, in the same transaction as the edit.
"""
from __future__ import annotations

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.asset_users.models import AssetUser
from app.core.deps import check_work_area
from app.masters import audit
from app.masters.models import CostCenter, Vendor
from app.purchase_orders.models import PendingAsset, PurchaseOrder
from app.purchase_orders.service import active_or_error, ensure_po_open, line_area

LOCKED_AFTER_RECEIPT = ("vendor_id", "cost_center_id", "po_number", "po_date")
FIELD_WORDS = {"vendor_id": "vendor", "cost_center_id": "cost centre", "po_number": "PO number", "po_date": "PO date"}


def _words(fields: list[str]) -> str:
    names = [FIELD_WORDS[f] for f in fields]
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def _date_text(value) -> str | None:
    return value.strftime("%d-%m-%Y") if value is not None else None


async def _name(session: AsyncSession, model, id_: int | None) -> str | None:
    if id_ is None:
        return None
    obj = await session.get(model, id_)
    return obj.name if obj is not None else None


async def update_po_header(
    session: AsyncSession, po: PurchaseOrder, sent: dict, actor: AssetUser, domains: tuple[str, ...] | None,
) -> PurchaseOrder:
    """Applies the header edit or raises ValueError (422, a plain sentence). Work-area refusals are 403
    (HTTPException from check_work_area). Flushes; the caller commits."""
    ensure_po_open(po)
    lines = (await session.execute(select(PendingAsset).where(PendingAsset.purchase_order_id == po.id))).scalars().all()
    for line in lines:
        check_work_area(domains, await line_area(session, line))

    for field, message in (("cost_center_id", "Choose the cost centre."), ("po_date", "Choose the PO date."),
                           ("po_number", "PO number cannot be blank.")):
        if field in sent and sent[field] is None:
            raise ValueError(message)
    if "po_number" in sent:
        sent["po_number"] = (sent["po_number"] or "").strip()
        if not sent["po_number"]:
            raise ValueError("PO number cannot be blank.")

    def changes(field: str) -> bool:
        if field not in sent:
            return False
        if field == "po_number":
            return sent[field] != (po.po_number or "").strip()
        return sent[field] != getattr(po, field)

    changed = [f for f in ("vendor_id", "cost_center_id", "delivery_asset_user_id", "po_number", "po_date") if changes(f)]
    if not changed:
        return po

    if po.erp_po_code is not None:
        erp_owned = [f for f in ("po_number", "po_date") if f in changed]
        if erp_owned:
            raise ValueError(
                "This purchase order was made from the ERP, so its PO number and PO date are the ERP's and "
                "cannot be changed here."
            )
        if "vendor_id" in changed:
            raise ValueError(
                "This purchase order was made from the ERP, so its vendor follows the ERP supplier. When the ERP "
                "moves it to another supplier, apply that from the ERP changes of this purchase order."
            )

    received = any(line.status == "DELIVERED" for line in lines)
    locked = [f for f in LOCKED_AFTER_RECEIPT if f in changed]
    if received and locked:
        raise ValueError(
            f"Goods have already been received on this purchase order, so its {_words(locked)} can no longer be "
            "changed (the received assets keep what they were received with). Only the delivery place can still "
            "be changed."
        )

    if "vendor_id" in changed:
        await active_or_error(session, Vendor, sent["vendor_id"], "vendor")
    if "cost_center_id" in changed:
        cost_center = await active_or_error(session, CostCenter, sent["cost_center_id"], "cost centre")
        if cost_center.company_id != po.company_id:
            raise ValueError("The cost centre must belong to the same company as the purchase order.")
    if "delivery_asset_user_id" in changed and sent["delivery_asset_user_id"] is not None:
        delivery = await session.get(AssetUser, sent["delivery_asset_user_id"])
        if delivery is None or not delivery.is_active:
            raise ValueError("The delivery location you chose does not exist or is no longer active.")
        if delivery.company_id != po.company_id:
            raise ValueError("The delivery location must belong to the same company as the purchase order.")
    if "po_number" in changed:
        clash = (await session.execute(
            select(PurchaseOrder.id).where(
                PurchaseOrder.company_id == po.company_id, PurchaseOrder.id != po.id,
                func.lower(func.trim(PurchaseOrder.po_number)) == sent["po_number"].lower(),
                PurchaseOrder.is_active.is_(True),
            ).limit(1)
        )).scalar_one_or_none()
        if clash is not None:
            raise ValueError(f"Purchase order {sent['po_number']} already exists for this company.")

    audit.record(session, entity="purchase_order", entity_id=po.id, actor_id=actor.id, changes={
        "vendor": (await _name(session, Vendor, po.vendor_id), await _name(session, Vendor, sent.get("vendor_id")))
        if "vendor_id" in changed else (None, None),
        "cost_centre": (await _name(session, CostCenter, po.cost_center_id),
                        await _name(session, CostCenter, sent.get("cost_center_id")))
        if "cost_center_id" in changed else (None, None),
        "delivery_place": (await _name(session, AssetUser, po.delivery_asset_user_id),
                           await _name(session, AssetUser, sent.get("delivery_asset_user_id")))
        if "delivery_asset_user_id" in changed else (None, None),
        "po_number": (po.po_number, sent.get("po_number")) if "po_number" in changed else (None, None),
        "po_date": (_date_text(po.po_date), _date_text(sent.get("po_date"))) if "po_date" in changed else (None, None),
    })
    for field in changed:
        setattr(po, field, sent[field])
    po.updated_by = actor.id
    if "cost_center_id" in changed:
        # nothing is received (checked above): the waiting units carry the new cost centre to their assets
        await session.execute(
            update(PendingAsset)
            .where(PendingAsset.purchase_order_id == po.id, PendingAsset.status == "PENDING")
            .values(cost_center_id=sent["cost_center_id"], updated_by=actor.id)
        )
    await session.flush()
    return po
