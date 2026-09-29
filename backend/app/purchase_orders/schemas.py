from datetime import date
from pydantic import BaseModel, ConfigDict


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


class PendingAssetLineIn(BaseModel):
    description: str
    barcode: str | None = None
    category_id: int
    subcategory_id: int | None = None
    brand: str | None = None
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
    brand: str | None = None
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
    brand: str | None
    model: str | None
    warranty_years: int | None
    cost_center_id: int
    purchase_cost: float | None
    tax_percent: float | None
    tax_amount: float | None
    total_cost: float | None
    status: str
    serial_number: str | None
    invoice_number: str | None
    invoice_date: date | None
    invoice_amount: float | None
    initial_holder_id: int | None
    delivered_asset_id: int | None


class DeliveryLineIn(BaseModel):
    pending_asset_id: int
    serial_number: str
    initial_holder_id: int


class DeliveryDoneIn(BaseModel):
    invoice_number: str
    invoice_date: date
    invoice_amount: float
    lines: list[DeliveryLineIn]
