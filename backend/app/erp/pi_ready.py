"""Which invoices received in CKAM already have their PI done in the ERP.

Goods are received here with the vendor's bill number and date; the ERP books the purchase invoice (PI) later. CKAM's
copy of the ERP's PIs (`erp_pi`, filled by the ERP copy) is searched by (company, vendor bill number), so every
invoice received here shows one of:

  recorded    every asset of the invoice already has a PI number in CKAM
  ready       the ERP has a POSTED PI for that bill: a person can add it
  not_posted  the ERP has started a PI but not posted it yet (never offered)
  waiting     the ERP has no PI for that bill yet

The vendor is checked too: the PI's vendor must be the vendor linked to this PO's vendor in that company; a PI booked
under a catch-all vendor such as "OTHER" (CKVPL does this) or for a vendor that is not linked is offered with a note, and a
PI of another linked vendor is ignored. Nothing here writes: adding the PI to the assets is `record_pi_for_invoice`,
only ever after a person confirms. The ERP is read only through the copy, never live."""
import re
from collections import defaultdict

from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.assets.models import Asset
from app.erp.mirror_models import ErpPiCopy, bill_key
from app.masters.models import AssetCategory, Company, Vendor, VendorErpLink
from app.purchase_orders.models import PendingAsset, PurchaseOrder
from app.purchase_orders.service import _in_area

CATCH_ALL_VENDOR = re.compile(r"^\s*(other|others|misc|miscellaneous|general|sundry|cash)\b", re.IGNORECASE)
AMOUNT_TOLERANCE = 2.0          # rupees: the vendor's total and the ERP's header total can differ by rounding
LOOKUP_CHUNK = 400

NOTE_OTHER = "Booked under the vendor OTHER in the ERP: check it is this vendor's bill."
NOTE_UNLINKED = "This vendor is not linked to an ERP supplier, so the PI's vendor could not be checked."


async def pi_copy_exists(session: AsyncSession) -> bool:
    """False until the ERP copy has brought in at least one purchase invoice (so a screen can say "not copied yet"
    instead of "the ERP has no PI")."""
    return (await session.execute(select(ErpPiCopy.pi_code).limit(1))).first() is not None


def _amount_check(invoice_amount: float | None, pi: ErpPiCopy) -> str:
    """Does the amount typed on the invoice here equal the PI's total (or its lines before tax)? A hint, never a block."""
    if invoice_amount is None:
        return "unknown"
    for value in (pi.amount, pi.lines_amount):
        if value is not None and abs(float(value) - float(invoice_amount)) <= AMOUNT_TOLERANCE:
            return "matches"
    return "differs"


def _candidate(pi: ErpPiCopy, invoice_amount: float | None, note: str | None) -> dict:
    return {
        "pi_code": pi.pi_code, "pi_number": pi.pi_number, "pi_date": pi.pi_date.isoformat() if pi.pi_date else None,
        "pi_amount": float(pi.amount) if pi.amount is not None else None,
        "vendor_invoice_no": pi.bill_no, "vendor_invoice_date": pi.bill_date.isoformat() if pi.bill_date else None,
        "erp_vendor_name": pi.vendor_name, "posted": (pi.release_status or "").upper() == "P",
        "amount_check": _amount_check(invoice_amount, pi), "vendor_note": note,
    }


async def _invoices(session: AsyncSession, po_ids: list[int] | None, domains: tuple[str, ...] | None) -> dict[tuple[int, str], dict]:
    """The invoices received under POs: (po_id, invoice number) -> the facts the matching needs."""
    stmt = (
        select(PendingAsset.purchase_order_id, PendingAsset.invoice_number, PendingAsset.invoice_date, PendingAsset.invoice_amount,
               Asset.pi_number)
        .join(AssetCategory, AssetCategory.id == PendingAsset.category_id)
        .join(Asset, Asset.id == PendingAsset.delivered_asset_id)
        .where(PendingAsset.status == "DELIVERED", PendingAsset.invoice_number.is_not(None), Asset.deleted_at.is_(None))
        .order_by(PendingAsset.id)
    )
    if po_ids is not None:
        stmt = stmt.where(PendingAsset.purchase_order_id.in_(po_ids))
    out: dict[tuple[int, str], dict] = {}
    for po_id, number, inv_date, amount, pi_number in (await session.execute(_in_area(stmt, domains))).all():
        invoice_number = (number or "").strip()
        if not invoice_number:
            continue
        inv = out.setdefault((po_id, invoice_number), {"po_id": po_id, "invoice_number": invoice_number, "assets": 0, "with_pi": 0, "pis": set()})
        inv["invoice_date"] = inv_date
        inv["invoice_amount"] = float(amount) if amount is not None else None
        inv["assets"] += 1
        if (pi_number or "").strip():
            inv["with_pi"] += 1
            inv["pis"].add(pi_number.strip())
    return out


async def _po_facts(session: AsyncSession, po_ids: set[int], allowed_company_ids: list[int] | None) -> dict[int, dict]:
    rows = (await session.execute(
        select(PurchaseOrder.id, PurchaseOrder.po_number, PurchaseOrder.company_id, PurchaseOrder.vendor_id, Company, Vendor.name)
        .join(Company, Company.id == PurchaseOrder.company_id)
        .outerjoin(Vendor, Vendor.id == PurchaseOrder.vendor_id)
        .where(PurchaseOrder.id.in_(po_ids), PurchaseOrder.is_active.is_(True))
    )).all()
    return {
        po_id: {"po_number": number, "company_id": company_id, "vendor_id": vendor_id, "company_code": company.erp_code,
                "company_name": company.name, "vendor_name": vendor_name}
        for po_id, number, company_id, vendor_id, company, vendor_name in rows
        if allowed_company_ids is None or company_id in allowed_company_ids
    }


async def _pis_by_bill(session: AsyncSession, pairs: set[tuple[str, str]]) -> dict[tuple[str, str], list[ErpPiCopy]]:
    found: dict[tuple[str, str], list[ErpPiCopy]] = defaultdict(list)
    wanted = sorted(pairs)
    for start in range(0, len(wanted), LOOKUP_CHUNK):
        chunk = wanted[start:start + LOOKUP_CHUNK]
        rows = (await session.execute(
            select(ErpPiCopy).where(ErpPiCopy.is_present.is_(True), tuple_(ErpPiCopy.company_code, ErpPiCopy.bill_no_norm).in_(chunk))
            .order_by(ErpPiCopy.pi_date, ErpPiCopy.pi_code)
        )).scalars().all()
        for pi in rows:
            found[(pi.company_code, pi.bill_no_norm)].append(pi)
    return found


def _row_status(inv: dict, c: dict) -> str:
    """The status of one PI against one invoice (the words the PO's PI dialog already knows)."""
    if not c["posted"]:
        return "not_posted"
    if inv["assets"] and inv["with_pi"] == inv["assets"] and inv["pis"] == {c["pi_number"]}:
        return "done"
    if inv["pis"] and inv["pis"] != {c["pi_number"]}:
        return "different"
    return "ready"


def _invoice_state(inv: dict, statuses: list[str]) -> str:
    if inv["assets"] and inv["with_pi"] == inv["assets"]:
        return "recorded"
    if "ready" in statuses:
        return "ready"       # a PI that conflicts with one already recorded ("different") is left to the PO page, which can overwrite
    if "not_posted" in statuses:
        return "not_posted"
    return "waiting"


async def invoice_states(
    session: AsyncSession, *, po_ids: list[int] | None = None, allowed_company_ids: list[int] | None = None,
    domains: tuple[str, ...] | None = None,
) -> list[dict]:
    """One row per invoice received under a PO: what CKAM holds, the PIs the ERP copy has for that bill (vendor
    checked) and the resulting `state` (recorded / ready / not_posted / waiting)."""
    invoices = await _invoices(session, po_ids, domains)
    if not invoices:
        return []
    pos = await _po_facts(session, {k[0] for k in invoices}, allowed_company_ids)
    invoices = {k: v for k, v in invoices.items() if k[0] in pos}
    if not invoices:
        return []
    pairs = {(pos[i["po_id"]]["company_code"], bill_key(i["invoice_number"])) for i in invoices.values() if bill_key(i["invoice_number"])}
    pis = await _pis_by_bill(session, pairs)
    vendor_ids = {p["vendor_id"] for p in pos.values() if p["vendor_id"] is not None}
    links: dict[tuple[int, int], set[str]] = defaultdict(set)
    if vendor_ids:
        for vendor_id, company_id, code in (await session.execute(
            select(VendorErpLink.vendor_id, VendorErpLink.company_id, VendorErpLink.erp_vendor_code).where(VendorErpLink.vendor_id.in_(vendor_ids))
        )).all():
            links[(vendor_id, company_id)].add(str(code))

    out = []
    for inv in invoices.values():
        po = pos[inv["po_id"]]
        linked = links.get((po["vendor_id"], po["company_id"]), set()) if po["vendor_id"] is not None else set()
        candidates: list[dict] = []
        key = bill_key(inv["invoice_number"])
        for pi in pis.get((po["company_code"], key), []) if key else []:
            if pi.vendor_code in linked:
                note = None
            elif CATCH_ALL_VENDOR.match(pi.vendor_name or ""):
                note = NOTE_OTHER
            elif not linked:
                note = NOTE_UNLINKED
            else:
                continue                       # the bill number belongs to another vendor of this company
            c = _candidate(pi, inv["invoice_amount"], note)
            c["status"] = _row_status(inv, c)
            candidates.append(c)
        out.append({
            **po, "po_id": inv["po_id"], "invoice_number": inv["invoice_number"],
            "invoice_date": inv["invoice_date"].isoformat() if inv.get("invoice_date") else None, "invoice_amount": inv["invoice_amount"],
            "assets": inv["assets"], "recorded": inv["with_pi"], "recorded_pis": sorted(inv["pis"]),
            "candidates": candidates, "state": _invoice_state(inv, [c["status"] for c in candidates]),
        })
    out.sort(key=lambda r: (r["po_number"], r["invoice_number"]))
    return out


async def po_pi_preview(session: AsyncSession, po: PurchaseOrder, domains: tuple[str, ...] | None) -> dict:
    """The PO's PI dialog: one row per (invoice received here, PI the ERP holds for that bill)."""
    states = await invoice_states(session, po_ids=[po.id], domains=domains)
    rows = []
    for s in states:
        if s["state"] == "recorded" and not s["candidates"]:
            continue
        for c in s["candidates"]:
            rows.append({
                "pi_number": c["pi_number"], "pi_date": c["pi_date"], "pi_amount": c["pi_amount"],
                "vendor_invoice_no": c["vendor_invoice_no"], "vendor_invoice_date": c["vendor_invoice_date"],
                "ckam_invoice_number": s["invoice_number"], "ckam_invoice_amount": s["invoice_amount"], "match": "invoice",
                "assets": s["assets"], "recorded": s["recorded"], "status": c["status"], "posted": c["posted"],
                "amount_check": c["amount_check"], "vendor_note": c["vendor_note"], "pi_code": c["pi_code"],
            })
    return {
        "po_id": po.id, "po_number": po.po_number, "rows": rows,
        "not_booked": sum(1 for s in states if s["state"] == "waiting"),
        "ckam_invoices": sorted(s["invoice_number"] for s in states), "delivered_assets": sum(s["assets"] for s in states),
    }


async def ready_counts(session: AsyncSession, po_ids: list[int], domains: tuple[str, ...] | None) -> dict[int, int]:
    """For the PO list: how many invoices of each PO have a posted PI in the ERP that CKAM does not hold yet."""
    if not po_ids:
        return {}
    counts: dict[int, int] = defaultdict(int)
    for s in await invoice_states(session, po_ids=po_ids, domains=domains):
        if s["state"] == "ready":
            counts[s["po_id"]] += 1
    return dict(counts)


async def worklist(
    session: AsyncSession, allowed_company_ids: list[int] | None, domains: tuple[str, ...] | None,
) -> dict:
    """Every invoice received here whose PI is not recorded yet, with what the ERP says: `ready` and `not_posted`
    rows (the screen lists them) and the counts of each state, `waiting` included."""
    states = [s for s in await invoice_states(session, allowed_company_ids=allowed_company_ids, domains=domains) if s["state"] != "recorded"]
    counts = {"ready": 0, "not_posted": 0, "waiting": 0}
    for s in states:
        counts[s["state"]] += 1
    rows = [s for s in states if s["state"] in ("ready", "not_posted")]
    rows.sort(key=lambda r: (r["state"] != "ready", r["po_number"], r["invoice_number"]))
    return {"counts": {**counts, "ready_pos": len({s["po_id"] for s in states if s["state"] == "ready"})}, "rows": rows}
