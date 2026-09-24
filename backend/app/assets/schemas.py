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
    """AM-02: expanded to mirror the Asset model's business/procurement fields --
    these were already captured correctly on create (AssetCreateIn already had
    them; the columns and migration already existed from the original build)
    but were never returned to any client, so nothing in the frontend could
    ever display vendor/PO/invoice/PI/brand/model/serial/warranty/custom
    fields even though they were being saved. Purely additive to the response
    contract; existing consumers (which only read the previously-exposed
    subset) are unaffected."""
    model_config = ConfigDict(from_attributes=True)
    id: int
    asset_code: str
    legacy_asset_code: str | None
    company_id: int
    cost_center_id: int
    category_id: int
    subcategory_id: int | None
    brand: str | None
    model: str | None
    serial_number: str | None
    description: str
    vendor_id: int | None
    po_number: str | None
    po_date: date | None
    invoice_number: str | None
    invoice_date: date | None
    pi_number: str | None
    pi_date: date | None
    purchase_cost: float | None
    tax_percent: float | None
    tax_amount: float | None
    total_cost: float | None
    purchase_date: date
    warranty_upto: date | None
    status: str
    current_holder_id: int
    status_since: date
    custom_fields: dict


class AssetUpdateIn(BaseModel):
    """The EDITABLE DESCRIPTIVE DATA subset only -- see the Asset Field Policy
    Matrix in docs/ai/AM-02_ASSET_DATA_MODEL_REPORT.md. Deliberately excludes:
    asset_code/company_id/cost_center_id (DB-trigger immutable), status/
    current_holder_id/status_since (lifecycle-controlled, apply_event only),
    category_id/subcategory_id/purchase_date (controlled master/date
    references -- not yet exposed via generic edit, see the report), and
    quantity/initial_holder_id (create-only, meaningless on an existing row).
    A PUT replaces this whole editable subset in one call, matching this
    codebase's existing convention (e.g. HolderIn on `PUT /api/holders/{id}`)
    rather than a partial-PATCH merge."""
    legacy_asset_code: str | None = None
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
    warranty_upto: date | None = None
    custom_fields: dict | None = None
