from datetime import date
from pydantic import BaseModel, Field
from app.bundles.schemas import BundleLineAmountIn


class DraftLineIn(BaseModel):
    item_code: str | None = None
    group_code: str | None = None
    description: str = Field(min_length=1, max_length=500)
    barcode: str
    quantity: int = Field(ge=1, le=1000)
    rate: float = Field(gt=0)
    tax_percent: float = Field(default=0, ge=0, le=100)
    warranty_years: int = Field(default=0, ge=0)
    category_id: int | None = None
    subcategory_id: int | None = None
    brand_id: int | None = None
    model: str | None = None
    # A bundle line becomes one line per part; `bundle_parts` carries the
    # (possibly edited) amount per part, else the bundle's own split is used.
    bundle_id: int | None = None
    bundle_parts: list[BundleLineAmountIn] | None = None
    remember: bool = False


class DraftCreateIn(BaseModel):
    erp_po_code: int | None = None
    company_id: int
    po_number: str
    po_date: date
    vendor_id: int | None = None
    cost_center_id: int
    delivery_asset_user_id: int | None = None
    warehouse_code: str | None = None
    lines: list[DraftLineIn] = Field(min_length=1)


class ErpVendorCodeIn(BaseModel):
    erp_vendor_code: str = Field(min_length=1, max_length=50)
