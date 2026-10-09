from datetime import date
from pydantic import BaseModel, ConfigDict, Field


class PurchaseOrderCreateIn(BaseModel):
    company_id: int
    po_number: str
    po_date: date
    vendor_id: int | None = None
    cost_center_id: int


class PurchaseOrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    po_number: str
    po_date: date
    vendor_id: int | None
    cost_center_id: int | None
    is_active: bool
    # AM-19: PI is recorded per Invoice, not per PO (see RecordPiIn's own
    # docstring) -- so a PO with more than one delivery/invoice can have a
    # mix of recorded and pending PIs at once. "NOT_DELIVERED": nothing
    # delivered under this PO yet. "PENDING": at least one delivered asset
    # still has no PI Number. "RECORDED": every delivered asset has one.
    # pi_number/pi_date are only ever populated when every delivered asset
    # shares the exact same value (a single-invoice PO, the common case) --
    # a multi-invoice PO with different PI numbers leaves them None even
    # when RECORDED, since there is no one value to show here; the PO
    # detail page's own per-invoice Record PI section has the real detail.
    pi_status: str = "NOT_DELIVERED"
    pi_number: str | None = None
    pi_date: date | None = None


class PendingAssetLineIn(BaseModel):
    description: str
    barcode: str | None = None
    category_id: int
    subcategory_id: int | None = None
    brand_id: int | None = None
    model: str | None = None
    # AM-18: mandatory like Add Asset's own warranty_years -- 0 means "no
    # warranty". Entered once per line, inherited by every unit this line's
    # quantity creates, same as barcode/description already are.
    warranty_years: int = 0
    purchase_cost: float | None = None
    tax_percent: float | None = None
    quantity: int = 1


class PendingAssetLineUpdateIn(BaseModel):
    description: str
    barcode: str | None = None
    category_id: int
    subcategory_id: int | None = None
    brand_id: int | None = None
    model: str | None = None
    warranty_years: int = 0
    purchase_cost: float | None = None
    tax_percent: float | None = None


class PendingAssetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    purchase_order_id: int
    company_id: int
    description: str
    barcode: str | None
    category_id: int
    subcategory_id: int | None
    brand_id: int | None
    model: str | None
    warranty_years: int | None
    cost_center_id: int
    purchase_cost: float | None
    tax_percent: float | None
    tax_amount: float | None
    total_cost: float | None
    status: str
    serial_required: bool = True
    bundle_label: str | None = None
    serial_number: str | None
    invoice_number: str | None
    invoice_date: date | None
    invoice_amount: float | None
    initial_asset_user_id: int | None
    delivered_asset_id: int | None


class DeliveryLineIn(BaseModel):
    pending_asset_id: int
    serial_number: str
    initial_asset_user_id: int


class DeliveryDoneIn(BaseModel):
    invoice_number: str
    invoice_date: date
    invoice_amount: float
    lines: list[DeliveryLineIn]


class SerialCheckIn(BaseModel):
    serials: list[str] = Field(max_length=2000)


class SerialConflictOut(BaseModel):
    serial: str
    asset_code: str


class SerialCheckOut(BaseModel):
    conflicts: list[SerialConflictOut]


class RecordPiIn(BaseModel):
    """AM-19: PI arrives per Invoice, not per PO -- a PO delivered across
    several partial deliveries gets one Invoice (and later one PI) per
    delivery, never a single PI for the whole PO. See
    app.purchase_orders.service.record_pi_for_invoice."""
    invoice_number: str
    pi_number: str
    pi_date: date
    # False (default): only fills in assets whose PI is still blank.
    # True: overwrites every matching asset's PI, the deliberate escape
    # hatch for fixing a typo across all of them at once.
    overwrite: bool = False


class RecordPiOut(BaseModel):
    invoice_number: str
    updated: list[str]
    skipped: list[str]


class PurchaseOrderDeleteOut(BaseModel):
    cancelled_lines: int
    deleted_assets: int
