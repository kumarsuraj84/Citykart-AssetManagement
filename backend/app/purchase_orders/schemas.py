from datetime import date
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from app.core.validation import (
    InModel, MAX_AMOUNT, MAX_QUANTITY, MAX_WARRANTY_YEARS, not_in_future, require_text,
)


class PurchaseOrderCreateIn(InModel):
    company_id: int
    po_number: str = Field(max_length=100)
    po_date: date
    vendor_id: int | None = None
    cost_center_id: int
    delivery_asset_user_id: int | None = None
    warehouse_code: str | None = Field(default=None, max_length=100)

    @field_validator("po_number")
    @classmethod
    def _po_number(cls, value: str) -> str:
        return require_text(value, "PO number")

    @field_validator("po_date")
    @classmethod
    def _po_date(cls, value: date) -> date:
        return not_in_future(value, "PO date")


class PurchaseOrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    po_number: str
    po_date: date
    vendor_id: int | None
    cost_center_id: int | None
    delivery_asset_user_id: int | None = None
    warehouse_code: str | None = None
    erp_po_code: int | None = None
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


class PendingAssetLineUpdateIn(InModel):
    description: str = Field(max_length=500)
    barcode: str | None = Field(default=None, max_length=200)
    item_id: int | None = None
    category_id: int | None = None
    subcategory_id: int | None = None
    brand_id: int | None = None
    model: str | None = Field(default=None, max_length=200)
    warranty_years: int = Field(default=0, ge=0, le=MAX_WARRANTY_YEARS)
    purchase_cost: float | None = Field(default=None, ge=0, le=MAX_AMOUNT)
    tax_percent: float | None = Field(default=None, ge=0, le=100)

    @field_validator("description")
    @classmethod
    def _description(cls, value: str) -> str:
        return require_text(value, "Description")


class PendingAssetLineIn(PendingAssetLineUpdateIn):
    # The Item decides the Category and Sub-Category (the server fills them in
    # and overrides anything sent); category_id is only needed without an Item.
    # AM-18: warranty_years is mandatory like Add Asset's own -- 0 means "no
    # warranty". Entered once per line, inherited by every unit this line's
    # quantity creates, same as barcode/description already are.
    # S0.2: quantity 1..1000 -- each unit is its own row, so an unbounded
    # quantity used to let one request exhaust the server's memory.
    quantity: int = Field(default=1, ge=1, le=MAX_QUANTITY)


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
    serial_later: bool = False
    bundle_label: str | None = None
    item_id: int | None = None
    erp_item_code: str | None = None
    serial_number: str | None
    invoice_number: str | None
    invoice_date: date | None
    invoice_amount: float | None
    initial_asset_user_id: int | None
    delivered_asset_id: int | None


class DeliveryLineIn(InModel):
    pending_asset_id: int
    # Omitted only with serial_pending (the serial is read and added later).
    serial_number: str | None = Field(default=None, max_length=200)
    serial_pending: bool = False
    initial_asset_user_id: int

    @model_validator(mode="after")
    def _serial_or_later(self):
        if self.serial_pending:
            self.serial_number = None
            return self
        # S0.5: a blank serial used to create an asset that was neither
        # "pending" nor "N/A" -- it must be a real value, N/A, or "add it later".
        self.serial_number = (self.serial_number or "").strip() or None
        if self.serial_number is None:
            raise ValueError("A serial number (or N/A, or 'add it later') is needed for every delivered unit.")
        return self


class DeliveryDoneIn(InModel):
    invoice_number: str = Field(max_length=100)
    invoice_date: date
    invoice_amount: float = Field(ge=0, le=MAX_AMOUNT)
    lines: list[DeliveryLineIn] = Field(min_length=1, max_length=MAX_QUANTITY)

    @field_validator("invoice_number")
    @classmethod
    def _invoice_number(cls, value: str) -> str:
        return require_text(value, "Invoice number")

    @field_validator("invoice_date")
    @classmethod
    def _invoice_date(cls, value: date) -> date:
        return not_in_future(value, "Invoice date")


class SerialCheckIn(InModel):
    serials: list[str] = Field(max_length=2000)


class SerialConflictOut(BaseModel):
    serial: str
    asset_code: str


class SerialCheckOut(BaseModel):
    conflicts: list[SerialConflictOut]


class RecordPiIn(InModel):
    """AM-19: PI arrives per Invoice, not per PO -- a PO delivered across
    several partial deliveries gets one Invoice (and later one PI) per
    delivery, never a single PI for the whole PO. See
    app.purchase_orders.service.record_pi_for_invoice."""
    invoice_number: str = Field(max_length=100)
    pi_number: str = Field(max_length=100)
    pi_date: date

    @field_validator("pi_number")
    @classmethod
    def _pi_number(cls, value: str) -> str:
        return require_text(value, "PI number")
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
