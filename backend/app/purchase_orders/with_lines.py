"""S3a-2: the one-screen manual purchase order -- header, lines and sets in ONE transaction.

Nothing new is implemented here: the header goes through create_purchase_order, every line through
add_pending_asset_line (line number from next_line_no, category / sub-category / work area / serial mode
from the Item) and every set through add_bundle_lines (one line per part). This module only fills the
defaults the one-screen form leaves out, from the Item, the same way the ERP draft does: description = the
Item's name (plus the brand and model typed on the line), brand = the Item's default brand, warranty = the
Item's default warranty; and it makes the barcode optional (blank = none stored; labels print the asset
code, delivery never needs a barcode). Any refusal names the line ("Line 2: ...") or set ("Set 1: ...")
and the caller rolls the whole PO back."""
from fastapi import HTTPException

from sqlalchemy.ext.asyncio import AsyncSession

from app.asset_users.models import AssetUser
from app.bundles.models import Bundle
from app.bundles.service import add_bundle_lines
from app.core.problems import Refused
from app.items.models import Item
from app.masters.models import Brand
from app.purchase_orders.models import PurchaseOrder
from app.purchase_orders.service import add_pending_asset_line, create_purchase_order


def _blank_to_none(value: str | None) -> str | None:
    return (value or "").strip() or None


async def _line_values(session: AsyncSession, ln: dict) -> dict:
    item = await session.get(Item, ln["item_id"])
    if item is None:
        raise ValueError("The Item you chose does not exist.")
    if not item.is_active:
        raise ValueError(f"The Item {item.name} is no longer active; choose another.")
    brand_id = ln.get("brand_id")
    if brand_id is None and item.default_brand_id is not None:
        default = await session.get(Brand, item.default_brand_id)
        brand_id = default.id if default is not None and default.is_active else None   # a retired default is just not used
    description = _blank_to_none(ln.get("description"))
    if description is None:
        words = [item.name]
        if ln.get("brand_id") is not None:
            brand = await session.get(Brand, ln["brand_id"])
            if brand is not None:
                words.append(brand.name)
        if _blank_to_none(ln.get("model")):
            words.append(ln["model"].strip())
        description = " ".join(words)[:500]
    warranty = ln.get("warranty_years")
    if warranty is None:
        warranty = item.default_warranty_years or 0
    return {
        "item_id": item.id, "description": description, "barcode": _blank_to_none(ln.get("barcode")),
        "brand_id": brand_id, "model": _blank_to_none(ln.get("model")), "warranty_years": warranty,
        "purchase_cost": ln["purchase_cost"], "tax_percent": ln.get("tax_percent"), "quantity": ln["quantity"],
    }


async def _set_values(session: AsyncSession, st: dict) -> dict:
    bundle = await session.get(Bundle, st["bundle_id"])
    if bundle is None or not bundle.is_active:
        raise ValueError("The set you chose does not exist or is no longer active.")
    return {
        "bundle_id": bundle.id, "description": _blank_to_none(st.get("description")) or bundle.name,
        "barcode": _blank_to_none(st.get("barcode")), "barcode_optional": True,
        "quantity": st["quantity"], "price": st["price_per_set"],
        "tax_percent": st.get("tax_percent"), "warranty_years": st.get("warranty_years") or 0,
        "parts": st.get("part_amounts"),
    }


def _labelled(label: str, exc: Exception) -> Exception:
    if isinstance(exc, HTTPException):
        return HTTPException(exc.status_code, f"{label}: {exc.detail}")
    return ValueError(f"{label}: {exc}")


async def create_po_with_lines(
    session: AsyncSession, data: dict, actor: AssetUser, allowed_domains: tuple[str, ...] | None,
) -> tuple[PurchaseOrder, int, int]:
    """Creates the PO, its lines (in the order sent, line numbers 1..n) and then its sets (one line number
    per part). Returns (PO, lines created, units created). Raises ValueError / HTTPException (403 for the
    other work area) naming the line; the caller rolls everything back."""
    header = {k: data.get(k) for k in ("company_id", "po_number", "po_date", "vendor_id", "cost_center_id",
                                        "delivery_asset_user_id", "warehouse_code")}
    po = await create_purchase_order(session, header, actor)
    line_nos: set[int] = set()
    units = 0
    # S5: every line and set is tried (each in its own savepoint) so ALL their problems come back at once
    # (`problems: [{line_index | set_index, message}]`); any problem -> nothing is created (the caller rolls
    # the whole PO back). A line of another work area is still a 403 straight away.
    problems: list[dict] = []
    for position, ln in enumerate(data.get("lines") or [], start=1):
        try:
            async with session.begin_nested():
                made = await add_pending_asset_line(session, po, await _line_values(session, ln), actor, allowed_domains=allowed_domains)
        except HTTPException as exc:
            raise _labelled(f"Line {position}", exc) from exc
        except ValueError as exc:
            problems.append({"line_index": position, "message": str(exc)})
            continue
        line_nos.update(u.line_no for u in made)
        units += len(made)
    for position, st in enumerate(data.get("sets") or [], start=1):
        try:
            async with session.begin_nested():
                made = await add_bundle_lines(session, po, await _set_values(session, st), actor, allowed_domains=allowed_domains)
        except HTTPException as exc:
            raise _labelled(f"Set {position}", exc) from exc
        except ValueError as exc:
            problems.append({"set_index": position, "message": str(exc)})
            continue
        line_nos.update(u.line_no for u in made)
        units += len(made)
    if problems:
        raise Refused(problems, "Nothing was created")
    return po, len(line_nos), units
