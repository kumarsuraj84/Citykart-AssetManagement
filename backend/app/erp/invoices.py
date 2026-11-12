"""PI (purchase invoice) numbers from the ERP, for the invoices received under a PO.

CKAM records the PI per vendor invoice (`record_pi_for_invoice`); the ERP books a PI later, against the vendor's own bill
number. CKAM's copy of the ERP's PIs is searched by that bill number (see `app.erp.pi_ready`), the matches are shown as a
preview, and a PI is recorded only when a person confirms. Nothing is written to the ERP, and a PI that is not posted in
the ERP yet is never recorded."""
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.asset_users.models import AssetUser
from app.erp.pi_ready import po_pi_preview
from app.purchase_orders.models import PurchaseOrder
from app.purchase_orders.service import record_pi_for_invoice


async def pi_preview(session: AsyncSession, po: PurchaseOrder, domains: tuple[str, ...] | None = None) -> dict:
    return await po_pi_preview(session, po, domains)


async def apply_pi(
    session: AsyncSession, actor: AssetUser, po: PurchaseOrder, requests: list[dict],
    allowed_domains: tuple[str, ...] | None = None,
) -> list[dict]:
    """Records the confirmed PIs. Each request names a PI and the CKAM invoice it goes to; both are checked against what
    the ERP copy holds right now, so the caller can never record a PI the ERP does not hold for that invoice's bill."""
    preview = await pi_preview(session, po, allowed_domains)
    results = []
    for req in requests:
        row = next((r for r in preview["rows"]
                    if r["pi_number"] == req["pi_number"] and r["ckam_invoice_number"] == req["ckam_invoice_number"]), None)
        if row is None:
            raise ValueError(f"PI {req['pi_number']} is not an ERP PI for invoice {req['ckam_invoice_number']} of this purchase order")
        if not row["posted"]:
            raise ValueError(f"PI {req['pi_number']} is not posted in the ERP yet, so it cannot be recorded")
        if not row["pi_date"]:
            raise ValueError(f"PI {req['pi_number']} has no date in the ERP")
        result = await record_pi_for_invoice(
            session, po, row["ckam_invoice_number"], row["pi_number"], date.fromisoformat(row["pi_date"]),
            bool(req.get("overwrite")), actor, allowed_domains=allowed_domains,
        )
        results.append(result)
    return results
