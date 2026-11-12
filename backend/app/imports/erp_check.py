"""Old-data import: what CKAM's copy of the ERP knows about each row of the sheet.

An old asset in the sheet names its PO number, the vendor's bill (invoice) number and, perhaps, vendor and PI. The ERP
copy (all PO and PI history, see `app.erp.sync`) is searched for them and the answer is shown row by row; with the
person's say-so the commit fills the cells the sheet left BLANK, and only those:

  * PO Date           from the ERP PO with that number in the row's company
  * Vendor Code       the CKAM vendor linked to that PO's ERP supplier (only when the sheet gave none)
  * PI Number / Date  the ONE posted PI the ERP holds for the invoice's bill number (company + vendor checked, as the
                      PI-ready feature does); two PIs for one bill, or a PI not posted yet, are only noted
  * Invoice Date      the bill date of that PI, when the sheet gave none (this is also the asset's purchase date)

Anything the sheet already says is never overwritten: a difference (PO date, vendor, PI number) is a note on the row.
Nothing is written to the ERP, and nothing here guesses: no PO, no PI and no fill when the match is not certain."""
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.erp.mirror_models import ErpPiCopy, ErpPoLineCopy, bill_key
from app.erp.pi_ready import _candidate, _pis_by_bill, vendor_check
from app.masters.models import Vendor, VendorErpLink


def _text(value) -> str:
    return (str(value).strip() if value is not None else "")


def _po_key(value) -> str:
    return _text(value).casefold()


@dataclass
class RowCheck:
    """What the ERP says about one sheet row. `fill` holds ISO-string values (and `vendor_id`); `fill_vendor` the object."""
    po: dict | None = None
    pi: dict | None = None
    fill: dict = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    fill_vendor: Vendor | None = None

    @property
    def status(self) -> str:
        if self.fill:
            return "fill"
        if self.notes:
            return "check"
        if (self.po and self.po.get("found")) or (self.pi and self.pi.get("found")):
            return "ok"
        return "none"

    def public(self) -> dict:
        return {"status": self.status, "po": self.po, "pi": self.pi, "fill": self.fill, "notes": self.notes}


async def erp_copy_state(session: AsyncSession) -> dict:
    """Whether the ERP copy holds POs and PIs yet (a check against an empty copy would say 'not found' for everything)."""
    po = (await session.execute(select(ErpPoLineCopy.po_code).limit(1))).first() is not None
    pi = (await session.execute(select(ErpPiCopy.pi_code).limit(1))).first() is not None
    return {"po_copied": po, "pi_copied": pi}


async def check_rows(session: AsyncSession, rows: list[dict]) -> dict[int, RowCheck]:
    """`rows` are the sheet's valid rows (see asset_import_service._validate_add_rows); returns row number -> RowCheck."""
    checks: dict[int, RowCheck] = {r["row"]: RowCheck() for r in rows}
    if not rows:
        return checks
    company_code = {r["row"]: r["company"].erp_code for r in rows}

    # ---- the ERP POs named in the sheet (company + PO number) -------------------------------------------------------
    wanted_po = {(company_code[r["row"]], _po_key(r["po_number"])) for r in rows if _po_key(r["po_number"])}
    po_map: dict[tuple[str, str], list[dict]] = defaultdict(list)
    if wanted_po:
        numbers = sorted({n for _, n in wanted_po})
        stmt = (
            select(ErpPoLineCopy.company_code, ErpPoLineCopy.po_code, ErpPoLineCopy.po_number, ErpPoLineCopy.po_date,
                   ErpPoLineCopy.supplier_code, ErpPoLineCopy.supplier_name, func.count().label("lines"))
            .where(ErpPoLineCopy.is_present.is_(True), ErpPoLineCopy.company_code.in_({c for c, _ in wanted_po}),
                   func.lower(func.trim(ErpPoLineCopy.po_number)).in_(numbers))
            .group_by(ErpPoLineCopy.company_code, ErpPoLineCopy.po_code, ErpPoLineCopy.po_number, ErpPoLineCopy.po_date,
                      ErpPoLineCopy.supplier_code, ErpPoLineCopy.supplier_name)
        )
        for c, po_code, number, po_date, supplier_code, supplier_name, lines in (await session.execute(stmt)).all():
            if (c, _po_key(number)) in wanted_po:
                po_map[(c, _po_key(number))].append({
                    "po_code": po_code, "po_number": _text(number), "po_date": po_date, "supplier_code": str(supplier_code),
                    "supplier_name": supplier_name, "lines": lines})

    # ---- vendors: the sheet's vendors' ERP links, and which CKAM vendor each ERP supplier is -----------------------------
    company_ids = {r["company"].id for r in rows}
    linked_codes: dict[tuple[int, int], set[str]] = defaultdict(set)         # (vendor_id, company_id) -> ERP codes
    vendor_of_code: dict[tuple[int, str], int] = {}                           # (company_id, ERP code) -> vendor_id
    link_rows = (await session.execute(
        select(VendorErpLink.vendor_id, VendorErpLink.company_id, VendorErpLink.erp_vendor_code)
        .where(VendorErpLink.company_id.in_(company_ids))
    )).all()
    for vendor_id, company_id, code in link_rows:
        vendor_of_code[(company_id, str(code))] = vendor_id
        linked_codes[(vendor_id, company_id)].add(str(code))
    fill_vendor_ids = {vendor_of_code[(r["company"].id, g["supplier_code"])]
                       for r in rows for g in po_map.get((company_code[r["row"]], _po_key(r["po_number"])), [])[:1]
                       if (r["company"].id, g["supplier_code"]) in vendor_of_code}
    fill_vendors = {v.id: v for v in (await session.execute(select(Vendor).where(Vendor.id.in_(fill_vendor_ids)))).scalars().all()} if fill_vendor_ids else {}

    # ---- the PIs for the sheet's bill numbers (company + bill number) -------------------------------------------------
    pairs = {(company_code[r["row"]], bill_key(r["invoice_number"])) for r in rows if bill_key(r["invoice_number"])}
    pis = await _pis_by_bill(session, pairs) if pairs else {}

    for r in rows:
        chk = checks[r["row"]]
        co = company_code[r["row"]]
        sheet_vendor: Vendor | None = r["vendor"]
        known_vendor_id = sheet_vendor.id if sheet_vendor is not None else None

        # -- PO ----------------------------------------------------------------------------------------------------------
        if _po_key(r["po_number"]):
            groups = po_map.get((co, _po_key(r["po_number"])), [])
            if not groups:
                chk.po = {"found": False}
                chk.notes.append(f"PO {_text(r['po_number'])} is not in the ERP for {co}.")
            elif len(groups) > 1:
                chk.po = {"found": True, "ambiguous": True}
                chk.notes.append(f"More than one ERP PO has the number {_text(r['po_number'])}: check it by hand.")
            else:
                g = groups[0]
                chk.po = {"found": True, "po_code": g["po_code"], "po_date": g["po_date"].isoformat() if g["po_date"] else None,
                          "supplier_code": g["supplier_code"], "supplier_name": g["supplier_name"], "lines": g["lines"]}
                if r["po_date"] is None and g["po_date"] is not None:
                    chk.fill["po_date"] = g["po_date"].isoformat()
                elif r["po_date"] is not None and g["po_date"] is not None and r["po_date"] != g["po_date"]:
                    chk.notes.append(f"PO date differs: the sheet says {r['po_date'].isoformat()}, the ERP {g['po_date'].isoformat()}.")
                if sheet_vendor is not None:
                    codes = linked_codes.get((sheet_vendor.id, r["company"].id), set())
                    if codes and g["supplier_code"] not in codes:
                        chk.notes.append(f"Vendor differs: the sheet says {sheet_vendor.name}, the ERP PO is for {g['supplier_name']}.")
                else:
                    vendor_id = vendor_of_code.get((r["company"].id, g["supplier_code"]))
                    if vendor_id is not None and vendor_id in fill_vendors:
                        chk.fill_vendor = fill_vendors[vendor_id]
                        chk.fill["vendor_id"] = vendor_id
                        chk.fill["vendor_name"] = fill_vendors[vendor_id].name
                        known_vendor_id = vendor_id
                    else:
                        chk.notes.append(f"The ERP supplier {g['supplier_name']} is not a vendor in CKAM yet (Settings › Vendors › Add from ERP).")

        # -- PI, by the vendor's bill number --------------------------------------------------------------------------------
        key = bill_key(r["invoice_number"])
        if key:
            linked = linked_codes.get((known_vendor_id, r["company"].id), set()) if known_vendor_id is not None else set()
            cands = []
            for pi in pis.get((co, key), []):
                acceptable, note = vendor_check(pi, linked)
                if acceptable:
                    cands.append(_candidate(pi, r["invoice_amount"], note))
            posted = [c for c in cands if c["posted"]]
            chk.pi = {"found": bool(cands), "candidates": [
                {k: c[k] for k in ("pi_number", "pi_date", "pi_amount", "posted", "amount_check", "vendor_note", "vendor_invoice_date")} for c in cands]}
            sheet_pi = _text(r["pi_number"])
            if not cands:
                chk.notes.append(f"No PI in the ERP for the bill number {_text(r['invoice_number'])} yet.")
            elif not posted:
                chk.notes.append(f"The PI for bill {_text(r['invoice_number'])} is started in the ERP but not posted yet.")
            elif len(posted) > 1:
                chk.notes.append(f"More than one PI in the ERP for bill {_text(r['invoice_number'])} ({', '.join(c['pi_number'] for c in posted)}): type the right one.")
            else:
                c = posted[0]
                chk.pi["suggested"] = {"pi_number": c["pi_number"], "pi_date": c["pi_date"]}
                if not sheet_pi:
                    chk.fill["pi_number"] = c["pi_number"]
                    if r["pi_date"] is None and c["pi_date"]:
                        chk.fill["pi_date"] = c["pi_date"]
                elif sheet_pi != c["pi_number"]:
                    chk.notes.append(f"PI differs: the sheet says {sheet_pi}, the ERP has {c['pi_number']} for this bill.")
                elif r["pi_date"] is None and c["pi_date"]:
                    chk.fill["pi_date"] = c["pi_date"]
                if r["invoice_date"] is None and c.get("vendor_invoice_date"):
                    chk.fill["invoice_date"] = c["vendor_invoice_date"]
                if c["amount_check"] == "differs":
                    chk.notes.append("The invoice amount in the sheet differs from the PI total: check it.")
                if c["vendor_note"]:
                    chk.notes.append(c["vendor_note"])
    return checks


def apply_fills(rows: list[dict], checks: dict[int, RowCheck], derive_purchase_date) -> int:
    """Writes the ERP's answers into the sheet rows' BLANK cells (never over a value the sheet gave). Returns how many rows
    were filled. `derive_purchase_date` is the importer's own rule (the invoice date, else today)."""
    filled = 0
    for r in rows:
        chk = checks.get(r["row"])
        if chk is None or not chk.fill:
            continue
        f = chk.fill
        changed = False
        if "po_date" in f and r["po_date"] is None:
            r["po_date"] = date.fromisoformat(f["po_date"]); changed = True
        if chk.fill_vendor is not None and r["vendor"] is None:
            r["vendor"] = chk.fill_vendor; changed = True
        if "pi_number" in f and not _text(r["pi_number"]):
            r["pi_number"] = f["pi_number"]; changed = True
        if "pi_date" in f and r["pi_date"] is None:
            r["pi_date"] = date.fromisoformat(f["pi_date"]); changed = True
        if "invoice_date" in f and r["invoice_date"] is None:
            r["invoice_date"] = date.fromisoformat(f["invoice_date"])
            r["purchase_date"] = derive_purchase_date(r["invoice_date"]); changed = True
        filled += 1 if changed else 0
    return filled


def summary(checks: dict[int, RowCheck], state: dict) -> dict:
    """The counts the preview screen shows above the rows."""
    values = list(checks.values())
    return {
        **state,
        "rows": len(values),
        "po_found": sum(1 for c in values if c.po and c.po.get("found")),
        "po_missing": sum(1 for c in values if c.po is not None and not c.po.get("found")),
        "pi_found": sum(1 for c in values if c.pi and c.pi.get("found")),
        "pi_missing": sum(1 for c in values if c.pi is not None and not c.pi.get("found")),
        "will_fill": sum(1 for c in values if c.fill),
        "to_check": sum(1 for c in values if c.notes),
    }
