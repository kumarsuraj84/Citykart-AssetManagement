from io import BytesIO
import openpyxl
import qrcode
from app.assets.models import Asset
from app.core.config import settings

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
        ws.append([
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
            a.brand, a.model, a.serial_number,
            a.warranty_upto.isoformat() if a.warranty_upto else None,
            a.legacy_asset_code,
        ] + [a.custom_fields.get(k) for k in custom_field_keys])
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
    ws.append(["Asset Code", "Field", "Old Value", "New Value", "Actor", "Changed At", "Request ID"])
    for change, asset_code, actor_name in rows:
        ws.append([
            asset_code, change.field_name, change.old_value, change.new_value,
            actor_name, change.created_at.isoformat(), change.request_id,
        ])
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
        ws.append([asset_code, event.event_type, event.event_date.isoformat(),
                   from_holder_name, to_holder_name, event.remarks])
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
