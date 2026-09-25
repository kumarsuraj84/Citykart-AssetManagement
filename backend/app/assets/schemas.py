from datetime import date, datetime
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
    barcode: str | None
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
    # AM-11: the register must be able to answer "who holds it" without a
    # click into every row -- CKAM's own stated core guarantee
    # (docs/ai/PRODUCT_CONTEXT.md). Populated by `list_assets` via a
    # page-scoped batch id->name lookup (only the distinct ids actually
    # present on the current page, not every holder/company in the
    # system), never a per-row join. `None` only if the referenced holder/
    # company row is somehow missing -- should not happen in practice.
    current_holder_name: str | None = None
    company_name: str | None = None


class AssetDetailOut(AssetOut):
    """AM-04: Asset 360 needs human-readable labels, not bare IDs (§25 of the
    AM-04 authorization) -- additive-only, single-asset GET response.
    Nullable everywhere a referenced master row could theoretically be
    missing (defensive; scoping/FKs should prevent this in practice). Adds
    every remaining label the list endpoint's own page-scoped batch lookup
    (AM-11, current_holder_name/company_name on AssetOut itself) does not
    already cover, since a single-asset page can afford a few more small
    lookups that a paginated list of up to 200 rows should not repeat."""
    category_name: str | None
    subcategory_name: str | None
    cost_center_name: str | None
    vendor_name: str | None
    current_holder_name: str | None
    current_holder_type: str | None
    location_name: str | None
    department_name: str | None


class AssetFieldChangeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    field_name: str
    old_value: str | None
    new_value: str | None
    actor_id: int
    actor_name: str | None = None
    request_id: str
    created_at: datetime
    # AM-07: only ever populated for a controlled correction row -- NULL on
    # every ordinary PUT-edit row. Its presence is what the frontend uses to
    # render a row as "CORRECTION" rather than an ordinary field edit.
    reason: str | None = None


class AssetCorrectionIn(BaseModel):
    """AM-07: a dedicated, narrower request shape for
    `POST /api/assets/{id}/corrections` -- deliberately NOT part of
    `AssetUpdateIn`/`PUT /api/assets/{id}`. Every field except `reason` is
    optional (a correction may touch just Category, just Purchase Date, or
    any combination); which of `category_id`/`subcategory_id`/
    `purchase_date` were actually included in the request body at all
    (`model_fields_set`) is what the router/service use to tell "not part
    of this correction" apart from "explicitly set to null" -- the second
    only being meaningful for `subcategory_id`, since Category and Purchase
    Date can never legitimately be cleared."""
    category_id: int | None = None
    subcategory_id: int | None = None
    purchase_date: date | None = None
    reason: str


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
    barcode: str | None = None
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
