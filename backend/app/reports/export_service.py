from io import BytesIO
import openpyxl
import qrcode
from app.assets.models import Asset
from app.core.config import settings


def assets_to_xlsx(assets: list[Asset]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Asset Code", "Legacy Code", "Description", "Status", "Purchase Date", "Purchase Cost", "Tax Amount", "Total Cost"])
    for a in assets:
        ws.append([a.asset_code, a.legacy_asset_code, a.description, a.status,
                   a.purchase_date.isoformat() if a.purchase_date else None,
                   float(a.purchase_cost) if a.purchase_cost is not None else None,
                   float(a.tax_amount) if a.tax_amount is not None else None,
                   float(a.total_cost) if a.total_cost is not None else None])
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
