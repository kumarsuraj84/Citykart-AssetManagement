from io import BytesIO
import openpyxl
import qrcode
from barcode import Code128
from barcode.writer import ImageWriter
from app.assets.models import Asset
from app.core.config import settings

# AM-09: openpyxl auto-detects a string cell value starting with "=" and sets
# its data_type to formula ('f') -- confirmed directly (Workbook().active.
# append(["=cmd|calc!A1"]) -> cell.data_type == "f"). Every free-text field in
# these exports (Description, Brand, Vendor name, a Custom Field's text value,
# a correction's Reason, ...) is user-controlled and, via Import in
# particular, can originate from an externally-supplied spreadsheet -- so an
# unescaped leading "=", "+", "-", or "@" (the four characters Excel's own
# formula bar, and CSV/XLSX "formula injection" guidance, treat as
# formula-starting) would become a live, executing formula for whoever next
# opens the exported report in Excel. Prefixing with a single leading
# apostrophe is the standard mitigation: Excel treats an apostrophe-prefixed
# cell as literal text and does not display the apostrophe itself, so a
# legitimate value is unaffected and never visibly altered.
_FORMULA_TRIGGER_CHARS = ("=", "+", "-", "@")


def _sanitize_cell(value):
    if isinstance(value, str) and value.startswith(_FORMULA_TRIGGER_CHARS):
        return "'" + value
    return value


def _sanitize_row(row: list) -> list:
    return [_sanitize_cell(v) for v in row]

# AM-06: the exported asset snapshot now matches the full V1 field set Add
# Asset/Import support -- human-readable labels (never a bare FK id) for
# every master relationship, same as AssetDetailOut already does for the
# single-asset GET. `labels` is the batch id->name maps built once per
# export call by app.reports.router._export_label_maps (never a per-row
# query -- this export can run to 50,000 rows). `custom_field_keys` is the
# already-computed, alphabetically-sorted column set (see
# app.reports.router::_export_custom_field_keys) -- a key not applicable to
# a given asset's company is simply blank for that row, never fabricated.
ASSET_EXPORT_COLUMNS = [
    "Asset Code", "Company", "Cost Centre", "Category", "Subcategory", "Description", "Status",
    "Current Holder", "Holder Type", "Location", "Vendor", "PO Number", "PO Date",
    "Invoice Number", "Invoice Date", "PI Number", "PI Date", "Purchase Date",
    "Purchase Cost", "Tax %", "Tax Amount", "Total Cost", "Brand", "Model",
    "Serial Number", "Warranty Upto", "Legacy Asset Code",
]


def assets_to_xlsx(assets: list[Asset], labels: dict, custom_field_keys: list[str]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(ASSET_EXPORT_COLUMNS + [f"Custom:{k}" for k in custom_field_keys])
    for a in assets:
        holder = labels["holder"].get(a.current_holder_id, {})
        ws.append(_sanitize_row([
            a.asset_code,
            labels["company"].get(a.company_id),
            labels["cost_center"].get(a.cost_center_id),
            labels["category"].get(a.category_id),
            labels["subcategory"].get(a.subcategory_id) if a.subcategory_id else None,
            a.description,
            a.status,
            holder.get("name"),
            holder.get("holder_type"),
            holder.get("location_name"),
            labels["vendor"].get(a.vendor_id) if a.vendor_id else None,
            a.po_number,
            a.po_date.isoformat() if a.po_date else None,
            a.invoice_number,
            a.invoice_date.isoformat() if a.invoice_date else None,
            a.pi_number,
            a.pi_date.isoformat() if a.pi_date else None,
            a.purchase_date.isoformat() if a.purchase_date else None,
            float(a.purchase_cost) if a.purchase_cost is not None else None,
            float(a.tax_percent) if a.tax_percent is not None else None,
            float(a.tax_amount) if a.tax_amount is not None else None,
            float(a.total_cost) if a.total_cost is not None else None,
            labels["brand"].get(a.brand_id) if a.brand_id else None, a.model, a.serial_number,
            a.warranty_upto.isoformat() if a.warranty_upto else None,
            a.legacy_asset_code,
        ] + [a.custom_fields.get(k) for k in custom_field_keys]))
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def field_changes_to_xlsx(rows: list[tuple]) -> bytes:
    """AM-06: the field-change audit (`asset_field_change`) gets its own
    export, never flattened into the asset register above -- these are
    different canonical datasets (see docs/ai/DECISIONS.md). `rows` are
    (AssetFieldChange, asset_code, actor_name) tuples, same join-in-the-
    router pattern `movements_to_xlsx` already uses so the exported "Asset
    Code"/"Actor" columns hold real values, not internal ids."""
    wb = openpyxl.Workbook()
    ws = wb.active
    # AM-17 DEF-02: Reason (the sole discriminator between a controlled
    # correction row and an ordinary edit row -- reason IS NOT NULL means
    # correction, see AssetFieldChange's own docstring) was missing from
    # this export even though it's central to this audit trail; it was
    # already visible via GET /api/assets/{id}/changes, just not exported.
    ws.append(["Asset Code", "Field", "Old Value", "New Value", "Actor", "Changed At", "Request ID", "Reason"])
    for change, asset_code, actor_name in rows:
        ws.append(_sanitize_row([
            asset_code, change.field_name, change.old_value, change.new_value,
            actor_name, change.created_at.isoformat(), change.request_id, change.reason,
        ]))
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def movements_to_xlsx(rows: list[tuple]) -> bytes:
    """`rows` are (AssetEvent, asset_code, from_holder_name, to_holder_name) tuples --
    a raw internal `asset_id`/`holder_id` in a column literally headed "Asset Code"/
    "From Holder"/"To Holder" would make this export useless to the auditors and store
    staff it's actually for, so the router joins in the human-readable values before
    calling this."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Asset Code", "Event", "Date", "From Holder", "To Holder", "Remarks"])
    for event, asset_code, from_holder_name, to_holder_name in rows:
        ws.append(_sanitize_row([asset_code, event.event_type, event.event_date.isoformat(),
                   from_holder_name, to_holder_name, event.remarks]))
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _asset_detail_url(asset_id: int) -> str:
    return f"{settings.base_url}/assets/{asset_id}"


def asset_qr_png(asset_id: int) -> bytes:
    img = qrcode.make(_asset_detail_url(asset_id))
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# Bulk physical labelling (scan a batch in Print Labels, print, paste on the
# asset): deliberately a DIFFERENT encode target from `asset_qr_png` above --
# that one encodes a deep link (for opening the asset's page from a phone
# camera), this one encodes the bare `asset_code` as plain text, matching
# exactly what a scan into any of this app's own scan fields (Asset
# Movement, Asset Register search, ...) expects to receive. Symbol choice
# (linear Code128 vs. QR) only changes which optical symbology gets
# printed; either decodes back to the identical asset_code string.
def asset_label_png(asset_code: str, symbol: str) -> bytes:
    buf = BytesIO()
    if symbol == "qr":
        qrcode.make(asset_code).save(buf, format="PNG")
    else:
        # write_text=False: the code128 image would otherwise print the
        # asset_code a second time under the bars in a tiny library font --
        # the label's own text line (asset code + description, styled by
        # the frontend) already covers that, in a size an operator can
        # actually read.
        Code128(asset_code, writer=ImageWriter()).write(buf, options={"write_text": False})
    return buf.getvalue()
