from datetime import date
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from app.bundles.schemas import BundleLineAmountIn
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


class PurchaseOrderUpdateIn(InModel):
    """S6: PUT /api/purchase-orders/{id} -- only the fields sent change (see app.purchase_orders.header)."""
    po_number: str | None = Field(default=None, max_length=100)
    po_date: date | None = None
    vendor_id: int | None = None
    cost_center_id: int | None = None
    delivery_asset_user_id: int | None = None

    @field_validator("po_date")
    @classmethod
    def _po_date(cls, value: date | None) -> date | None:
        return not_in_future(value, "PO date")


MAX_PO_ENTRIES = 100


class PoWithLinesLineIn(InModel):
    """One line of the one-screen manual PO: the Item decides category, sub-category, work area and serial
    mode; description / brand / warranty default from the Item when left out; barcode is optional."""
    item_id: int
    quantity: int = Field(ge=1, le=MAX_QUANTITY)
    purchase_cost: float = Field(ge=0, le=MAX_AMOUNT)
    tax_percent: float | None = Field(default=None, ge=0, le=100)
    description: str | None = Field(default=None, max_length=500)
    barcode: str | None = Field(default=None, max_length=200)
    brand_id: int | None = None
    model: str | None = Field(default=None, max_length=200)
    warranty_years: int | None = Field(default=None, ge=0, le=MAX_WARRANTY_YEARS)


class PoWithLinesSetIn(InModel):
    """One set (bundle) of the one-screen manual PO: `quantity` sets at `price_per_set` each (before tax),
    one line per part (`part_amounts` = the amount per part, else the bundle's own split)."""
    bundle_id: int
    quantity: int = Field(ge=1, le=MAX_QUANTITY)
    price_per_set: float = Field(gt=0, le=MAX_AMOUNT)
    tax_percent: float | None = Field(default=None, ge=0, le=100)
    description: str | None = Field(default=None, max_length=390)
    barcode: str | None = Field(default=None, max_length=200)
    warranty_years: int | None = Field(default=None, ge=0, le=MAX_WARRANTY_YEARS)
    part_amounts: list[BundleLineAmountIn] | None = Field(default=None, max_length=50)


class PurchaseOrderWithLinesIn(PurchaseOrderCreateIn):
    """S3a-2: a whole manual PO in one call -- header, lines and sets, all or nothing."""
    lines: list[PoWithLinesLineIn] = Field(default_factory=list, max_length=MAX_PO_ENTRIES)
    sets: list[PoWithLinesSetIn] = Field(default_factory=list, max_length=MAX_PO_ENTRIES)

    @model_validator(mode="after")
    def _something_to_order(self):
        if not self.lines and not self.sets:
            raise ValueError("Add at least one line or set.")
        if len(self.lines) + len(self.sets) > MAX_PO_ENTRIES:
            raise ValueError(f"A purchase order can have at most {MAX_PO_ENTRIES} lines and sets at a time.")
        return self


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
    # S2.3 (additive): names, and progress over the units the caller may see
    # (S0.3 work area). ordered = received + waiting (cancelled units are not
    # ordered any more). status: WAITING | PARTLY_RECEIVED | RECEIVED | CANCELLED.
    company_name: str | None = None
    vendor_name: str | None = None
    ordered_units: int = 0
    received_units: int = 0
    waiting_units: int = 0
    cancelled_units: int = 0
    status: str = "WAITING"


class PurchaseOrderWithLinesOut(PurchaseOrderOut):
    """The new PO (same shape as GET /purchase-orders/{id}) plus what was created: lines (line numbers;
    a set counts one per part) and units."""
    lines_created: int = 0
    units_created: int = 0


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
    # S2.4 (additive): the PO line (1..n) this unit was ordered on.
    line_no: int | None = None
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
    # S4 (additive): the received unit's asset code (None while waiting / cancelled).
    delivered_asset_code: str | None = None


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
    # S6 (additive): true when the conflicting asset is outside the caller's companies or work area, so
    # `asset_code` holds the wording "an asset outside your companies or work area" instead of a code.
    masked: bool = False


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
    # S2: always 0 now -- deleting a PO never removes assets (a PO with
    # received items cannot be deleted at all). Kept for compatibility.
    deleted_assets: int


# ---- S2.1: a purchase order by line ---------------------------------------

class LineGroupOut(BaseModel):
    """One PO line: every unit sharing a line number, counted over the units
    the caller may see. ordered = received + waiting."""
    line_no: int
    item_id: int | None = None
    item_name: str | None = None
    description: str
    barcode: str | None = None
    erp_item_code: str | None = None
    category_id: int | None = None
    category_name: str | None = None
    subcategory_id: int | None = None
    subcategory_name: str | None = None
    work_area: str | None = None
    brand_id: int | None = None
    brand_name: str | None = None
    model: str | None = None
    warranty_years: int | None = None
    rate: float | None = None
    tax_percent: float | None = None
    unit_total: float | None = None
    ordered: int
    received: int
    waiting: int
    cancelled: int
    line_value: float
    status: str
    serial_mode: str
    bundle_label: str | None = None
    waiting_unit_count: int


class LineGroupUpdateIn(InModel):
    """Edit a whole line. Only the fields sent are changed (the rest keep the
    line's current values); the same limits as editing one unit apply.
    `quantity` is the new ORDERED total (received + waiting)."""
    description: str | None = Field(default=None, max_length=500)
    barcode: str | None = Field(default=None, max_length=200)
    item_id: int | None = None
    category_id: int | None = None
    subcategory_id: int | None = None
    brand_id: int | None = None
    model: str | None = Field(default=None, max_length=200)
    warranty_years: int | None = Field(default=None, ge=0, le=MAX_WARRANTY_YEARS)
    purchase_cost: float | None = Field(default=None, ge=0, le=MAX_AMOUNT)
    tax_percent: float | None = Field(default=None, ge=0, le=100)
    quantity: int | None = Field(default=None, ge=0, le=MAX_QUANTITY)

    @field_validator("description")
    @classmethod
    def _description(cls, value: str | None) -> str:
        return require_text(value, "Description")


MAX_RECEIVE_LINES = 1000


class ReceiveLineIn(InModel):
    """One line of a receipt: how many of its waiting units arrive now (the server takes the oldest
    waiting ones), and their serials when the line has them."""
    line_no: int
    quantity: int = Field(ge=1, le=MAX_QUANTITY)
    # Leave out to use the line's own rule (from its Item); send to override it for this receipt.
    # HAS_SERIAL | NO_SERIAL | SERIAL_LATER (any letter case; checked by the service in plain words).
    serial_mode: str | None = Field(default=None, max_length=20)
    # HAS_SERIAL: exactly `quantity` serials (blank entries ignored, each trimmed), in unit order.
    serial_numbers: list[str] | None = Field(default=None, max_length=2 * MAX_QUANTITY)
    # Extra (custom) field values for every unit of the line ...
    custom_fields: dict | None = None
    # ... and optional per-unit values (aligned with the units / serials; they win for that unit).
    unit_custom_fields: list[dict | None] | None = Field(default=None, max_length=MAX_QUANTITY)


class ReceiveIn(InModel):
    """S4: a receipt against a purchase order. The common fields are entered once; the PO's delivery
    place is used when `received_into_asset_user_id` is left out."""
    received_into_asset_user_id: int | None = None
    invoice_number: str | None = Field(default=None, max_length=100)
    invoice_date: date | None = None
    invoice_amount: float | None = Field(default=None, le=MAX_AMOUNT)
    lines: list[ReceiveLineIn] = Field(min_length=1, max_length=MAX_RECEIVE_LINES)


class ReceivedAssetOut(BaseModel):
    asset_id: int
    asset_code: str
    line_no: int | None = None
    serial_number: str | None = None
    serial_pending: bool = False


class ReceiveOut(BaseModel):
    po_id: int
    invoice_number: str
    assets_created: int
    serial_pending: int
    assets: list[ReceivedAssetOut]
    label_asset_ids: list[int]
    # The PO's status and waiting units after the receipt (over the caller's work area).
    po_status: str | None = None
    waiting_units: int | None = None


class ReceiveInfoLineOut(BaseModel):
    line_no: int
    item_id: int | None = None
    item_name: str | None = None
    description: str
    ordered: int
    received_before: int
    waiting: int
    cancelled: int
    serial_mode: str
    work_area: str | None = None
    rate: float | None = None
    tax_percent: float | None = None
    unit_total: float | None = None
    erp_item_code: str | None = None
    brand_name: str | None = None
    model: str | None = None
    bundle_label: str | None = None
    status: str


class RequiredCustomFieldOut(BaseModel):
    id: int
    key: str
    label: str
    type: str
    options: dict | None = None
    sort_order: int = 0


class ReceiveInfoOut(BaseModel):
    po_id: int
    po_number: str
    po_date: date
    is_active: bool
    company_id: int
    company_name: str | None = None
    company_code: str | None = None
    vendor_id: int | None = None
    vendor_name: str | None = None
    received_into_asset_user_id: int | None = None
    received_into_name: str | None = None
    ordered_units: int
    received_units: int
    waiting_units: int
    lines: list[ReceiveInfoLineOut]
    required_custom_fields: list[RequiredCustomFieldOut]
    blockers: list[str]


class InvoiceSummaryOut(BaseModel):
    invoice_number: str | None
    invoice_date: date | None = None
    invoice_amount: float | None = None
    units: int
    asset_ids: list[int]
    asset_count: int
    asset_ids_truncated: bool = False
    pi_number: str | None = None
    pi_date: date | None = None
    pi_status: str


class CancelWaitingIn(InModel):
    # How many waiting units to cancel (the most recently added first);
    # leave out to cancel every waiting unit of the line.
    quantity: int | None = Field(default=None, ge=1, le=MAX_QUANTITY)


class CancelWaitingOut(BaseModel):
    cancelled_units: int
    # The PO's status afterwards (over the units the caller may see).
    status: str
