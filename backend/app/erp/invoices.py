"""PI (purchase invoice) numbers from the ERP, for a PO that was created from it.

CKAM records PI per vendor invoice (`record_pi_for_invoice`); the ERP books a PI
against the vendor's own invoice number. So an ERP PI is matched to the invoice
that was delivered here by that number, shown as a preview, and only recorded
when a person confirms. Nothing is written to the ERP."""
import re
from collections import defaultdict
from datetime import date
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.asset_users.models import AssetUser
from app.assets.models import Asset
from app.erp.source import ErpSource
from app.purchase_orders.models import PendingAsset, PurchaseOrder
from app.purchase_orders.service import record_pi_for_invoice


def _norm(text: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


async def pi_preview(session: AsyncSession, source: ErpSource, po: PurchaseOrder) -> dict:
    if po.erp_po_code is None:
        raise ValueError("This purchase order was not created from the ERP, so there is nothing to look up.")
    erp = await source.invoices([po.erp_po_code])
    with_pi = [i for i in erp if i.pi_number]
    not_booked = len(erp) - len(with_pi)

    rows = (await session.execute(
        select(PendingAsset.invoice_number, Asset.pi_number)
        .join(Asset, Asset.id == PendingAsset.delivered_asset_id)
        .where(PendingAsset.purchase_order_id == po.id, PendingAsset.invoice_number.is_not(None))
    )).all()
    ckam: dict[str, dict] = defaultdict(lambda: {"assets": 0, "pis": []})
    for invoice_number, pi_number in rows:
        entry = ckam[invoice_number]
        entry["assets"] += 1
        if (pi_number or "").strip():
            entry["pis"].append(pi_number.strip())
    by_norm = {_norm(k): k for k in ckam}

    out = []
    for inv in with_pi:
        target = by_norm.get(_norm(inv.vendor_invoice_no)) if inv.vendor_invoice_no else None
        match = "invoice" if target else "none"
        if target is None and len(ckam) == 1 and len(with_pi) == 1:
            target, match = next(iter(ckam)), "single"
        info = ckam.get(target) if target else None
        assets = info["assets"] if info else 0
        recorded = len(info["pis"]) if info else 0
        if info is None:
            status = "no_match"
        elif recorded == assets and all(p == inv.pi_number for p in info["pis"]):
            status = "done"
        elif recorded and any(p != inv.pi_number for p in info["pis"]):
            status = "different"
        else:
            status = "ready"
        out.append({
            "pi_number": inv.pi_number, "pi_date": inv.pi_date.isoformat() if inv.pi_date else None,
            "pi_amount": inv.pi_amount, "vendor_invoice_no": inv.vendor_invoice_no,
            "vendor_invoice_date": inv.vendor_invoice_date.isoformat() if inv.vendor_invoice_date else None,
            "ckam_invoice_number": target, "match": match, "assets": assets, "recorded": recorded, "status": status,
        })
    return {
        "po_id": po.id, "po_number": po.po_number, "rows": out, "not_booked": not_booked,
        "ckam_invoices": sorted(ckam), "delivered_assets": sum(v["assets"] for v in ckam.values()),
    }


async def apply_pi(
    session: AsyncSession, actor: AssetUser, source: ErpSource, po: PurchaseOrder, requests: list[dict],
) -> list[dict]:
    """Records the confirmed PIs. Each request names a PI and the CKAM invoice
    it goes to; both are checked against what the ERP says right now, so the
    caller can never record a PI number the ERP does not hold for this PO."""
    preview = await pi_preview(session, source, po)
    results = []
    for req in requests:
        row = next((r for r in preview["rows"]
                    if r["pi_number"] == req["pi_number"] and r["ckam_invoice_number"] == req["ckam_invoice_number"]), None)
        if row is None or row["match"] == "none" or row["ckam_invoice_number"] is None:
            raise ValueError(f"PI {req['pi_number']} is not an ERP PI for invoice {req['ckam_invoice_number']} of this purchase order")
        if not row["pi_date"]:
            raise ValueError(f"PI {req['pi_number']} has no date in the ERP")
        result = await record_pi_for_invoice(
            session, po, row["ckam_invoice_number"], row["pi_number"], date.fromisoformat(row["pi_date"]),
            bool(req.get("overwrite")), actor,
        )
        results.append(result)
    return results
