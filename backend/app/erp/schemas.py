from datetime import date, datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator
from app.bundles.schemas import BundleLineAmountIn
from app.core.validation import InModel, MAX_AMOUNT, MAX_QUANTITY, MAX_WARRANTY_YEARS, require_text


class DraftLineIn(InModel):
    item_code: str | None = Field(default=None, max_length=50)   # the ERP item code; kept on the asset as a link back to the PO/receipt/PI
    description: str = Field(min_length=1, max_length=500)
    barcode: str = Field(max_length=200)
    quantity: int = Field(ge=1, le=MAX_QUANTITY)
    rate: float = Field(gt=0, le=MAX_AMOUNT)
    tax_percent: float = Field(default=0, ge=0, le=100)
    warranty_years: int = Field(default=0, ge=0, le=MAX_WARRANTY_YEARS)
    # What the asset IS. Its category, sub-category, serial rule and bundle come
    # from the Item on the server, never from here.
    item_id: int
    brand_id: int | None = None
    model: str | None = Field(default=None, max_length=200)
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

    @field_validator("description")
    @classmethod
    def _description(cls, value: str) -> str:
        return require_text(value, "Description")


class DraftCreateIn(InModel):
    # S0.8: required in practice -- the server re-reads this ERP purchase order
    # from CKAM's ERP copy and takes the PO number, date and vendor from it.
    erp_po_code: int | None = None
    company_id: int
    po_number: str = Field(max_length=100)
    po_date: date
    vendor_id: int | None = None
    cost_center_id: int
    delivery_asset_user_id: int | None = None
    warehouse_code: str | None = Field(default=None, max_length=100)
    lines: list[DraftLineIn] = Field(min_length=1, max_length=500)


class PiApplyItemIn(BaseModel):
    pi_number: str
    ckam_invoice_number: str
    overwrite: bool = False


class PiApplyIn(BaseModel):
    items: list[PiApplyItemIn] = Field(min_length=1)


class ErpVendorLinkIn(BaseModel):
    """An ERP supplier of one company (the same code means a different supplier in each company)."""
    company_id: int
    erp_vendor_code: str = Field(min_length=1, max_length=50)


class StoresCreateIn(BaseModel):
    company_id: int
    codes: list[str] = Field(min_length=1, max_length=500)


class SyncRunOut(BaseModel):
    """One run of the copy of the ERP data (see app.erp.sync)."""
    model_config = ConfigDict(from_attributes=True)
    status: str
    trigger: str
    started_at: datetime
    finished_at: datetime | None = None
    source_stamp: datetime | None = None      # when the warehouse had last loaded the data this run copied
    message: str | None = None
    po_lines_new: int = 0
    po_lines_changed: int = 0
    po_lines_gone: int = 0
    vendors: int = 0
    items: int = 0


class SyncStatusOut(BaseModel):
    configured: bool
    last: SyncRunOut | None = None            # the latest run, whatever happened
    last_success: SyncRunOut | None = None    # the latest run that worked: the data on screen is as of this


class ChangeActionIn(BaseModel):
    """One difference from the ERP: apply it to this PO, or keep the PO as it is."""
    id: str
    mode: str = "apply"          # "apply" | "keep"


class ChangesApplyIn(BaseModel):
    items: list[ChangeActionIn] = Field(min_length=1, max_length=200)
