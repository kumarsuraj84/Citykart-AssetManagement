from datetime import date
from pydantic import BaseModel, ConfigDict


class PurchaseOrderCreateIn(BaseModel):
    company_id: int
    po_number: str
    po_date: date
    vendor_id: int | None = None


class PurchaseOrderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    company_id: int
    po_number: str
    po_date: date
    vendor_id: int | None
    is_active: bool


class PendingAssetLineIn(BaseModel):
    description: str
    category_id: int
    subcategory_id: int | None = None
    cost_center_id: int
    purchase_cost: float | None = None
    tax_percent: float | None = None
    quantity: int = 1


class PendingAssetLineUpdateIn(BaseModel):
    description: str
    category_id: int
    subcategory_id: int | None = None
    cost_center_id: int
    purchase_cost: float | None = None
    tax_percent: float | None = None


class PendingAssetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    purchase_order_id: int
    company_id: int
    description: str
    category_id: int
    subcategory_id: int | None
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
