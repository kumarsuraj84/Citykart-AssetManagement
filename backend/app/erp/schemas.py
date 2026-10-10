from datetime import date
from typing import Literal
from pydantic import BaseModel, Field
from app.bundles.schemas import BundleLineAmountIn


class DraftLineIn(BaseModel):
    item_code: str | None = None          # the ERP item code; kept on the asset as a link back to the PO/receipt/PI
    description: str = Field(min_length=1, max_length=500)
    barcode: str
    quantity: int = Field(ge=1, le=1000)
    rate: float = Field(gt=0)
    tax_percent: float = Field(default=0, ge=0, le=100)
    warranty_years: int = Field(default=0, ge=0)
    # What the asset IS. Its category, sub-category, serial rule and bundle come
    # from the Item on the server, never from here.
    item_id: int
    brand_id: int | None = None
    model: str | None = None
    # A bundle Item becomes one line per part; `bundle_parts` carries the
    # (possibly edited) amount per part, else the bundle's own split is used.
    bundle_parts: list[BundleLineAmountIn] | None = None
    # Remember this choice for the next PO: this one ERP code, this product name
    # inside its Article, or the whole Article. The Article facts below come from
    # the draft and are stored as a snapshot on the rule.
    map_scope: Literal["CODE", "NAME", "ARTICLE"] | None = None
    article_key: str | None = None
    article_name: str | None = None
    section: str | None = None
    department: str | None = None
    name_key: str | None = None


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


class PiApplyItemIn(BaseModel):
    pi_number: str
    ckam_invoice_number: str
    overwrite: bool = False


class PiApplyIn(BaseModel):
    items: list[PiApplyItemIn] = Field(min_length=1)


class ErpVendorCodeIn(BaseModel):
    erp_vendor_code: str = Field(min_length=1, max_length=50)
