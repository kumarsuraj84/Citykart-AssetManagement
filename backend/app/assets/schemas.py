from datetime import date
from pydantic import BaseModel, ConfigDict


class AssetCreateIn(BaseModel):
    company_id: int
    cost_center_id: int
    category_id: int
    subcategory_id: int | None = None
    brand: str | None = None
    model: str | None = None
    serial_number: str | None = None
    description: str
    vendor_id: int | None = None
    po_number: str | None = None
    po_date: date | None = None
    invoice_number: str | None = None
    invoice_date: date | None = None
    pi_number: str | None = None
    pi_date: date | None = None
    purchase_cost: float | None = None
    tax_percent: float | None = None
    purchase_date: date
    warranty_upto: date | None = None
    initial_holder_id: int
    legacy_asset_code: str | None = None
    custom_fields: dict | None = None
    quantity: int = 1


class AssetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    asset_code: str
    legacy_asset_code: str | None
    company_id: int
    description: str
    status: str
    current_holder_id: int
    purchase_cost: float | None
    tax_amount: float | None
    total_cost: float | None
