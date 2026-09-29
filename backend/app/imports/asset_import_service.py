"""AM-06: extends the Excel import path to the full V1 asset data model --
every procurement/descriptive field Add Asset supports (see
`app.assets.service.procure_assets`), quantity (multi-create per row, same
"buying 20 mice" case Add Asset already supports), and company-scoped
Custom Fields via the `Custom:<field_key>` column convention (see
`docs/ai/DECISIONS.md`).

Column headers are human-readable business names (`docs/ai/DECISIONS.md`
has the exact contract), looked up by name from the workbook's own header
row -- not positional -- so column order in an uploaded file never matters
and a stray/unknown column is simply ignored rather than shifting every
field after it.

Reuses, never reimplements: `app.assets.custom_field_values.
{applicable_custom_fields, validate_custom_field_values}` for company-scoped
UDF applicability/type/required-ness (AM-05's exact rule), and
`app.assets.service.compute_tax` for tax math (identical to manual Add
Asset). Atomicity/duplicate-detection/numbering semantics are UNCHANGED
from the pre-AM-06 behavior -- see the module-level notes on
`commit_import` below.

AM-23: Import now has two independent modes, `"add"` (this module's
original behaviour, kept up to date with Add Asset's own contract --
Purchase Date is derived from Invoice Date exactly like Add Asset itself,
never a direct column; Subcategory/Vendor/Serial Number are mandatory,
matching AssetCreateIn) and `"edit"` (new: bulk-corrects existing assets by
Asset Code). Edit mode deliberately does NOT reuse AssetUpdateIn's
full-replace-on-PUT contract -- a bulk edit template's blank cell means
"leave this field exactly as it is", never "clear it", since one row is
typically only touching one or two fields (e.g. filling in a PI Number
across many rows) and must never blank out everything else about that
asset. See `_validate_edit_rows`/`_commit_edit` below."""
from datetime import date, datetime, timezone
from decimal import Decimal
from io import BytesIO
import openpyxl
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.assets.audit_service import AUDITED_SCALAR_FIELDS, record_field_changes
from app.assets.custom_field_values import applicable_custom_fields, validate_custom_field_values
from app.assets.service import check_serial_number_unique, compute_tax, compute_warranty_upto
from app.asset_users.models import AssetUser
from app.lifecycle.service import apply_event
from app.lifecycle.state_machine import LifecycleError
from app.masters.models import AssetCategory, AssetSubcategory, Brand, Company, CostCenter, Location, Vendor
from app.numbering.models import CodeRule
from app.numbering.service import build_code_tokens, generate_code, get_active_rule
from app.assets.models import Asset

# Exact column-name contract -- see docs/ai/DECISIONS.md for the full table
# (backend mapping, format, requiredness, lookup rule). Order here is only
# the order `build_template` writes them in; parsing below is by header
# name, not position, so an uploaded file's column order never matters.
# AM-23: no "Purchase Date" column -- derived from Invoice Date exactly
# like Add Asset itself (see `_derive_purchase_date` below), never accepted
# directly. "Quantity" stays -- Import remains the tool for a genuine
# multi-unit bulk add (Add Asset itself dropped Quantity in AM-19, since a
# real Serial Number can never be shared across units anyway).
ADD_TEMPLATE_COLUMNS = [
    "Company Code", "Cost Centre Code", "Category Code", "Subcategory Code",
    "Description", "Legacy Asset Code",
    "Vendor Code", "PO Number", "PO Date", "Invoice Number", "Invoice Date", "Invoice Amount",
    "PI Number", "PI Date", "Purchase Cost", "Tax %",
    "Brand Code", "Model", "Serial Number", "Warranty Years",
    "Initial AssetUser Code", "Quantity",
]

# AM-23: Subcategory Code/Vendor Code/Serial Number moved here from optional
# -- AssetCreateIn (Add Asset's own contract) has required subcategory_id/
# vendor_id/serial_number; a genuinely serial-less unit still has a value to
# enter ("N/A", case-insensitive-exempt from uniqueness -- see
# check_serial_number_unique), the same escape hatch Add Asset itself relies on.
ADD_REQUIRED_COLUMNS = [
    "Company Code", "Cost Centre Code", "Category Code", "Subcategory Code",
    "Description", "Vendor Code", "Serial Number", "Initial AssetUser Code",
]

# AM-23: the bulk Edit-mode template -- Asset Code is the mandatory match
# key; every other column is the ordinary-editable descriptive/procurement
# subset AssetUpdateIn accepts (see docs/ai/AM-02_ASSET_DATA_MODEL_REPORT.md's
# Asset Field Policy Matrix), MINUS Category/Subcategory/Purchase Date
# (correction-workflow-only, see app.assets.correction_service) and PLUS
# nothing creation-only (no Company/Cost Centre/Initial AssetUser/Quantity --
# meaningless on a row that already exists).
EDIT_TEMPLATE_COLUMNS = [
    "Asset Code", "Legacy Asset Code", "Brand Code", "Model", "Serial Number", "Barcode",
    "Description", "Vendor Code", "PO Number", "PO Date", "Invoice Number", "Invoice Date",
    "Invoice Amount", "PI Number", "PI Date", "Purchase Cost", "Tax %", "Warranty Years",
]
EDIT_REQUIRED_COLUMNS = ["Asset Code"]

# Any header starting with this prefix is a Custom Field value column; the
# part after it is the field's stable `field_key` (never its display
# label -- a label rename must never break a saved spreadsheet). See
# docs/ai/DECISIONS.md for the full convention. Applies to both modes.
CUSTOM_FIELD_PREFIX = "Custom:"

# AM-23: a blank cell in Edit mode means "leave this field exactly as it
# is" -- this sentinel (never `None`, which is itself a valid value some
# fields could theoretically want to set) marks "not provided", so
# `_validate_edit_rows` can tell "cell was blank" apart from "cell asked to
# clear this field" everywhere below.
_UNSET = object()


def build_template(mode: str = "add") -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(EDIT_TEMPLATE_COLUMNS if mode == "edit" else ADD_TEMPLATE_COLUMNS)
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def _lookup(session: AsyncSession, model, **filters):
    stmt = select(model)
    for key, value in filters.items():
        stmt = stmt.where(getattr(model, key) == value)
    return (await session.execute(stmt)).scalars().first()


def _is_blank(value) -> bool:
    return value is None or (isinstance(value, str) and value.strip() == "")


def _parse_date_value(value, label: str) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        try:
            return datetime.strptime(value.strip(), "%Y-%m-%d").date()
        except ValueError:
            raise ValueError(f"{label} '{value}' is not a valid date (expected YYYY-MM-DD)")
    raise ValueError(f"{label} '{value}' is not a valid date (expected YYYY-MM-DD)")


def _parse_optional_date(value, label: str) -> date | None:
    if _is_blank(value):
        return None
    return _parse_date_value(value, label)


def _parse_quantity(value) -> int:
    if _is_blank(value):
        return 1
    try:
        quantity = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"Quantity '{value}' must be a whole number")
    if quantity < 1:
        raise ValueError("Quantity must be at least 1")
    return quantity


def _parse_warranty_years(value) -> int:
    """AM-18: mandatory like Add Asset's own warranty_years -- blank means 0
    ("no warranty"), matching AssetCreateIn's own schema default."""
    if _is_blank(value):
        return 0
    try:
        years = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"Warranty Years '{value}' must be a whole number")
    if years < 0:
        raise ValueError("Warranty Years cannot be negative")
    return years


def _parse_optional_number(value, label: str) -> float:
    if _is_blank(value):
        return 0.0
    if isinstance(value, bool):
        raise ValueError(f"{label} must be a number")
    try:
        return float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} '{value}' must be a number")


def _derive_purchase_date(invoice_date: date | None) -> date:
    """AM-23: matches app.assets.router.create_asset exactly -- Purchase
    Date is Invoice Date when known, else today (the day the row is
    actually being imported), never a directly-entered column."""
    return invoice_date or date.today()


# --- Edit-mode-only parsers: a blank cell means "leave untouched" (_UNSET),
# never a default value -- contrast with the add-mode parsers above, where
# blank means "use this default" because every add-mode row creates a brand
# new Asset that needs a real value for every field either way.
def _parse_edit_optional_date(value, label: str):
    if _is_blank(value):
        return _UNSET
    return _parse_date_value(value, label)


def _parse_edit_optional_number(value, label: str):
    if _is_blank(value):
        return _UNSET
    if isinstance(value, bool):
        raise ValueError(f"{label} must be a number")
    try:
        return float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} '{value}' must be a number")


def _parse_edit_warranty_years(value):
    if _is_blank(value):
        return _UNSET
    try:
        years = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"Warranty Years '{value}' must be a whole number")
    if years < 0:
        raise ValueError("Warranty Years cannot be negative")
    return years


def _cell_or_unset(value):
    """Plain-text edit-mode fields (Legacy Asset Code, Model, Barcode,
    Description, PO/Invoice/PI Number): blank means untouched; anything
    else is used as-is."""
    return _UNSET if _is_blank(value) else value


def _coerce_custom_value(raw, field_type: str):
    """Mirrors validate_custom_field_values's own type rules, but converts a raw
    Excel cell (which may already be a str/float/bool/date/datetime, depending on
    how the cell was formatted) into the shape that function expects -- most
    notably, a `date` field needs an ISO string, not a raw `date` object."""
    if field_type == "date":
        return _parse_date_value(raw, "value").isoformat()
    if field_type == "number":
        if isinstance(raw, bool):
            raise ValueError("must be a number")
        try:
            return float(raw)
        except (TypeError, ValueError):
            raise ValueError("must be a number")
    if field_type == "checkbox":
        if isinstance(raw, bool):
            return raw
        text = str(raw).strip().lower()
        if text in ("true", "yes", "1"):
            return True
        if text in ("false", "no", "0"):
            return False
        raise ValueError("must be true/false (or yes/no, 1/0)")
    # text / dropdown
    return str(raw).strip()


class ImportScopeError(PermissionError):
    """The file targets at least one company outside the importing actor's scope."""


class ImportTemplateError(ValueError):
    """The workbook itself is malformed (missing a required column) -- a
    file-level problem, not a row-level one."""


def _out_of_scope_message(label) -> str:
    return f"'{label}' is outside your company scope"


def _read_header(ws) -> dict[str, int]:
    try:
        header_row = next(ws.iter_rows(min_row=1, max_row=1, values_only=True))
    except StopIteration:
        return {}
    return {str(h).strip(): idx for idx, h in enumerate(header_row) if h is not None and str(h).strip() != ""}


async def _validate_add_rows(
    session: AsyncSession, content: bytes, allowed_company_ids: list[int] | None = None,
) -> tuple[list[dict], list[dict], list[dict]]:
    """Returns (valid_rows, errors, scope_violations). `allowed_company_ids` is the
    actor's `scoped_company_ids` (None = ADMIN, unrestricted); a row whose company
    is outside it is never valid, and is also reported in `scope_violations` so
    commit can refuse the whole file (403) rather than quietly skip it."""
    wb = openpyxl.load_workbook(BytesIO(content))
    ws = wb.active
    header = _read_header(ws)

    missing = [c for c in ADD_REQUIRED_COLUMNS if c not in header]
    if missing:
        raise ImportTemplateError(
            f"missing required column(s): {', '.join(missing)} -- re-download the template",
        )
    custom_headers = [h for h in header if h.startswith(CUSTOM_FIELD_PREFIX)]

    valid_rows: list[dict] = []
    errors: list[dict] = []
    scope_violations: list[dict] = []
    applicable_cache: dict[int, dict] = {}

    for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if row is None or all(v is None for v in row):
            continue

        def cell(name: str):
            idx = header.get(name)
            return row[idx] if idx is not None and idx < len(row) else None

        company_code = cell("Company Code")
        company = await _lookup(session, Company, code=company_code)
        if company is None:
            errors.append({"row": row_idx, "field": "Company Code", "message": f"unknown Company Code '{company_code}'"})
            continue
        if allowed_company_ids is not None and company.id not in allowed_company_ids:
            violation = {"row": row_idx, "field": "Company Code", "message": _out_of_scope_message(company_code)}
            errors.append(violation)
            scope_violations.append(violation)
            continue

        cc_code = cell("Cost Centre Code")
        cost_center = await _lookup(session, CostCenter, company_id=company.id, code=cc_code)
        if cost_center is None:
            errors.append({"row": row_idx, "field": "Cost Centre Code", "message": f"unknown Cost Centre Code '{cc_code}'"})
            continue

        cat_code = cell("Category Code")
        category = await _lookup(session, AssetCategory, code=cat_code)
        if category is None:
            errors.append({"row": row_idx, "field": "Category Code", "message": f"unknown Category Code '{cat_code}'"})
            continue

        # AM-23: mandatory, matching AssetCreateIn.subcategory_id.
        sub_code = cell("Subcategory Code")
        if _is_blank(sub_code):
            errors.append({"row": row_idx, "field": "Subcategory Code", "message": "Subcategory Code is required"})
            continue
        subcategory = await _lookup(session, AssetSubcategory, category_id=category.id, code=sub_code)
        if subcategory is None:
            errors.append({
                "row": row_idx, "field": "Subcategory Code",
                "message": f"unknown Subcategory Code '{sub_code}' for category '{cat_code}'",
            })
            continue

        description = cell("Description")
        if _is_blank(description):
            errors.append({"row": row_idx, "field": "Description", "message": "Description is required"})
            continue

        # Brand is optional, matching AssetCreateIn.brand_id -- a blank
        # cell means no brand; a filled one must resolve to a real Brand.
        brand_code = cell("Brand Code")
        brand = None
        if not _is_blank(brand_code):
            brand = await _lookup(session, Brand, code=brand_code)
            if brand is None:
                errors.append({"row": row_idx, "field": "Brand Code", "message": f"unknown Brand Code '{brand_code}'"})
                continue

        asset_user_code = cell("Initial AssetUser Code")
        asset_user = await _lookup(session, AssetUser, company_id=company.id, emp_code=asset_user_code)
        if asset_user is None:
            errors.append({"row": row_idx, "field": "Initial AssetUser Code", "message": f"unknown Initial AssetUser Code '{asset_user_code}'"})
            continue

        try:
            quantity = _parse_quantity(cell("Quantity"))
        except ValueError as exc:
            errors.append({"row": row_idx, "field": "Quantity", "message": str(exc)})
            continue

        # AM-23: mandatory, matching AssetCreateIn.vendor_id.
        vendor_code = cell("Vendor Code")
        if _is_blank(vendor_code):
            errors.append({"row": row_idx, "field": "Vendor Code", "message": "Vendor Code is required"})
            continue
        vendor = await _lookup(session, Vendor, code=vendor_code)
        if vendor is None:
            errors.append({"row": row_idx, "field": "Vendor Code", "message": f"unknown Vendor Code '{vendor_code}'"})
            continue

        # AM-23: mandatory, matching AssetCreateIn.serial_number ("N/A" is
        # the reserved, case-insensitive-exempt placeholder for a unit that
        # genuinely has none -- see check_serial_number_unique).
        serial_number = cell("Serial Number")
        if _is_blank(serial_number):
            errors.append({"row": row_idx, "field": "Serial Number", "message": "Serial Number is required (use \"N/A\" if this unit genuinely has none)"})
            continue

        try:
            po_date = _parse_optional_date(cell("PO Date"), "PO Date")
            invoice_date = _parse_optional_date(cell("Invoice Date"), "Invoice Date")
            pi_date = _parse_optional_date(cell("PI Date"), "PI Date")
        except ValueError as exc:
            errors.append({"row": row_idx, "message": str(exc)})
            continue
        # AM-23: derived, exactly like Add Asset itself -- never a direct column.
        purchase_date = _derive_purchase_date(invoice_date)

        try:
            warranty_years = _parse_warranty_years(cell("Warranty Years"))
        except ValueError as exc:
            errors.append({"row": row_idx, "field": "Warranty Years", "message": str(exc)})
            continue

        try:
            purchase_cost = _parse_optional_number(cell("Purchase Cost"), "Purchase Cost")
            tax_percent = _parse_optional_number(cell("Tax %"), "Tax %")
            invoice_amount = _parse_optional_number(cell("Invoice Amount"), "Invoice Amount")
        except ValueError as exc:
            errors.append({"row": row_idx, "message": str(exc)})
            continue

        # Company-scoped Custom Field values -- reuses AM-05's exact
        # applicability rule (Global + this row's own company only), never a
        # separate import-only UDF engine.
        if company.id not in applicable_cache:
            applicable_cache[company.id] = await applicable_custom_fields(session, company.id)
        applicable = applicable_cache[company.id]

        custom_values: dict = {}
        custom_error = False
        for header_name in custom_headers:
            raw = cell(header_name)
            if _is_blank(raw):
                continue
            key = header_name[len(CUSTOM_FIELD_PREFIX):].strip()
            field = applicable.get(key)
            if field is None:
                errors.append({
                    "row": row_idx, "field": header_name,
                    "message": f"custom field '{key}' is not applicable to this row's company "
                               "(unknown, inactive, or scoped to a different company)",
                })
                custom_error = True
                break
            try:
                custom_values[key] = _coerce_custom_value(raw, field.field_type)
            except ValueError as exc:
                errors.append({"row": row_idx, "field": header_name, "message": f"custom field '{key}' {exc}"})
                custom_error = True
                break
        if custom_error:
            continue

        try:
            await validate_custom_field_values(session, custom_values, company_id=company.id, enforce_required=True)
        except ValueError as exc:
            errors.append({"row": row_idx, "message": str(exc)})
            continue

        valid_rows.append({
            "row": row_idx, "legacy_asset_code": cell("Legacy Asset Code"), "company": company,
            "cost_center": cost_center, "category": category, "subcategory": subcategory,
            "description": description, "purchase_date": purchase_date, "asset_user": asset_user,
            "quantity": quantity, "vendor": vendor,
            "po_number": cell("PO Number"), "po_date": po_date,
            "invoice_number": cell("Invoice Number"), "invoice_date": invoice_date,
            "invoice_amount": invoice_amount,
            "pi_number": cell("PI Number"), "pi_date": pi_date,
            "purchase_cost": purchase_cost, "tax_percent": tax_percent,
            "brand": brand, "model": cell("Model"), "serial_number": serial_number,
            "warranty_years": warranty_years, "custom_fields": custom_values,
        })

    return valid_rows, errors, scope_violations


async def _validate_edit_rows(
    session: AsyncSession, content: bytes, allowed_company_ids: list[int] | None = None,
) -> tuple[list[dict], list[dict], list[dict]]:
    """AM-23: Edit mode's own validator -- matches an existing Asset by its
    Asset Code (the one column every asset already has, always known,
    always unique) and builds a PARTIAL update dict of only the columns
    that were actually filled in for that row. A blank cell is never an
    error and never clears a field -- it simply means this row doesn't
    touch that field (see the module docstring). Same
    (valid_rows, errors, scope_violations) shape as `_validate_add_rows`,
    so the router/preview/commit plumbing doesn't need to know which mode
    it's looking at."""
    wb = openpyxl.load_workbook(BytesIO(content))
    ws = wb.active
    header = _read_header(ws)

    missing = [c for c in EDIT_REQUIRED_COLUMNS if c not in header]
    if missing:
        raise ImportTemplateError(
            f"missing required column(s): {', '.join(missing)} -- re-download the template",
        )
    custom_headers = [h for h in header if h.startswith(CUSTOM_FIELD_PREFIX)]

    valid_rows: list[dict] = []
    errors: list[dict] = []
    scope_violations: list[dict] = []
    applicable_cache: dict[int, dict] = {}

    for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if row is None or all(v is None for v in row):
            continue

        def cell(name: str):
            idx = header.get(name)
            return row[idx] if idx is not None and idx < len(row) else None

        asset_code = cell("Asset Code")
        if _is_blank(asset_code):
            errors.append({"row": row_idx, "field": "Asset Code", "message": "Asset Code is required"})
            continue
        asset = await _lookup(session, Asset, asset_code=asset_code)
        if asset is None or asset.deleted_at is not None:
            errors.append({"row": row_idx, "field": "Asset Code", "message": f"unknown Asset Code '{asset_code}'"})
            continue
        if allowed_company_ids is not None and asset.company_id not in allowed_company_ids:
            violation = {"row": row_idx, "field": "Asset Code", "message": _out_of_scope_message(asset_code)}
            errors.append(violation)
            scope_violations.append(violation)
            continue

        updates: dict = {}
        row_error = False

        for field, column in (
            ("legacy_asset_code", "Legacy Asset Code"), ("model", "Model"),
            ("barcode", "Barcode"), ("description", "Description"),
            ("po_number", "PO Number"), ("invoice_number", "Invoice Number"), ("pi_number", "PI Number"),
        ):
            value = _cell_or_unset(cell(column))
            if value is not _UNSET:
                updates[field] = value

        serial_number = _cell_or_unset(cell("Serial Number"))
        if serial_number is not _UNSET:
            if serial_number != asset.serial_number:
                try:
                    await check_serial_number_unique(session, serial_number, exclude_asset_id=asset.id)
                except ValueError as exc:
                    errors.append({"row": row_idx, "field": "Serial Number", "message": str(exc)})
                    row_error = True
            if not row_error:
                updates["serial_number"] = serial_number
        if row_error:
            continue

        vendor_code = cell("Vendor Code")
        if not _is_blank(vendor_code):
            vendor = await _lookup(session, Vendor, code=vendor_code)
            if vendor is None:
                errors.append({"row": row_idx, "field": "Vendor Code", "message": f"unknown Vendor Code '{vendor_code}'"})
                continue
            updates["vendor_id"] = vendor.id

        brand_code = cell("Brand Code")
        if not _is_blank(brand_code):
            brand = await _lookup(session, Brand, code=brand_code)
            if brand is None:
                errors.append({"row": row_idx, "field": "Brand Code", "message": f"unknown Brand Code '{brand_code}'"})
                continue
            updates["brand_id"] = brand.id

        try:
            for field, column, label in (
                ("po_date", "PO Date", "PO Date"), ("invoice_date", "Invoice Date", "Invoice Date"),
                ("pi_date", "PI Date", "PI Date"),
            ):
                value = _parse_edit_optional_date(cell(column), label)
                if value is not _UNSET:
                    updates[field] = value
        except ValueError as exc:
            errors.append({"row": row_idx, "message": str(exc)})
            continue

        try:
            for field, column, label in (
                ("invoice_amount", "Invoice Amount", "Invoice Amount"),
                ("purchase_cost", "Purchase Cost", "Purchase Cost"),
                ("tax_percent", "Tax %", "Tax %"),
            ):
                value = _parse_edit_optional_number(cell(column), label)
                if value is not _UNSET:
                    updates[field] = value
        except ValueError as exc:
            errors.append({"row": row_idx, "message": str(exc)})
            continue

        try:
            warranty_years = _parse_edit_warranty_years(cell("Warranty Years"))
            if warranty_years is not _UNSET:
                updates["warranty_years"] = warranty_years
        except ValueError as exc:
            errors.append({"row": row_idx, "field": "Warranty Years", "message": str(exc)})
            continue

        # Company-scoped Custom Field values, same AM-05 applicability rule
        # as add mode -- but never enforce_required here: a partial edit
        # that doesn't mention a required custom field at all must not be
        # blocked by it (same reasoning as ordinary PUT /api/assets/{id},
        # see app.assets.custom_field_values's own module docstring).
        if asset.company_id not in applicable_cache:
            applicable_cache[asset.company_id] = await applicable_custom_fields(session, asset.company_id)
        applicable = applicable_cache[asset.company_id]

        custom_updates: dict = {}
        custom_error = False
        for header_name in custom_headers:
            raw = cell(header_name)
            if _is_blank(raw):
                continue
            key = header_name[len(CUSTOM_FIELD_PREFIX):].strip()
            field = applicable.get(key)
            if field is None:
                errors.append({
                    "row": row_idx, "field": header_name,
                    "message": f"custom field '{key}' is not applicable to this asset's company "
                               "(unknown, inactive, or scoped to a different company)",
                })
                custom_error = True
                break
            try:
                custom_updates[key] = _coerce_custom_value(raw, field.field_type)
            except ValueError as exc:
                errors.append({"row": row_idx, "field": header_name, "message": f"custom field '{key}' {exc}"})
                custom_error = True
                break
        if custom_error:
            continue

        if custom_updates:
            try:
                await validate_custom_field_values(session, custom_updates, company_id=asset.company_id, enforce_required=False)
            except ValueError as exc:
                errors.append({"row": row_idx, "message": str(exc)})
                continue

        if not updates and not custom_updates:
            errors.append({"row": row_idx, "message": "no editable fields were filled in for this row -- nothing to update"})
            continue

        valid_rows.append({
            "row": row_idx, "asset": asset, "asset_code": asset.asset_code,
            "updates": updates, "custom_updates": custom_updates,
        })

    return valid_rows, errors, scope_violations


async def preview_import(session: AsyncSession, content: bytes, allowed_company_ids: list[int] | None = None, mode: str = "add") -> dict:
    if mode == "edit":
        valid_rows, errors, _ = await _validate_edit_rows(session, content, allowed_company_ids)
        return {
            "valid_rows": [
                {
                    "row": r["row"], "asset_code": r["asset_code"],
                    "fields_changed": sorted(list(r["updates"].keys()) + [f"Custom:{k}" for k in r["custom_updates"]]),
                }
                for r in valid_rows
            ],
            "errors": errors,
        }

    valid_rows, errors, _ = await _validate_add_rows(session, content, allowed_company_ids)
    return {
        "valid_rows": [
            {
                "row": r["row"], "legacy_asset_code": r["legacy_asset_code"],
                "company": r["company"].name, "category": r["category"].name,
                "subcategory": r["subcategory"].name if r["subcategory"] else None,
                "description": r["description"], "asset_user": r["asset_user"].name, "quantity": r["quantity"],
            }
            for r in valid_rows
        ],
        "errors": errors,
    }


async def _commit_edit(session: AsyncSession, content: bytes, actor: AssetUser, allowed_company_ids: list[int] | None = None) -> dict:
    """AM-23: every OTHER valid row still commits if one row fails (e.g. a
    serial number collision surfaced only at commit time, not preview) --
    same VALID-ROWS-ONLY, per-row-savepoint philosophy `_commit_add`
    already uses, just one Asset UPDATE instead of one-or-more Asset
    INSERTs per row."""
    valid_rows, errors, scope_violations = await _validate_edit_rows(session, content, allowed_company_ids)
    if scope_violations:
        raise ImportScopeError("; ".join(f"row {v['row']}: {v['message']}" for v in scope_violations))

    updated = 0
    for r in valid_rows:
        asset = r["asset"]
        try:
            async with session.begin_nested():
                before = {field: getattr(asset, field) for field in AUDITED_SCALAR_FIELDS}
                before["custom_fields"] = dict(asset.custom_fields)

                for field, value in r["updates"].items():
                    setattr(asset, field, value)

                # Always recomputed from the EFFECTIVE (possibly untouched)
                # purchase_cost/tax_percent -- same rule ordinary Edit (PUT
                # /api/assets/{id}) already applies on every save, now over
                # values that may not have been part of this row at all.
                tax_amount, total_cost = compute_tax(asset.purchase_cost, asset.tax_percent)
                asset.tax_amount = tax_amount
                asset.total_cost = total_cost

                # Same AM-18 rule as ordinary Edit: only recomputed when
                # this row actually mentioned Warranty Years.
                if "warranty_years" in r["updates"]:
                    asset.warranty_upto = compute_warranty_upto(asset.purchase_date, asset.warranty_years)

                if r["custom_updates"]:
                    # MERGE, never replace -- a row's custom-field columns
                    # are just as partial as its ordinary ones.
                    asset.custom_fields = {**asset.custom_fields, **r["custom_updates"]}

                asset.updated_by = actor.id

                after = {field: getattr(asset, field) for field in AUDITED_SCALAR_FIELDS}
                after["custom_fields"] = dict(asset.custom_fields)
                await record_field_changes(session, asset_id=asset.id, actor_id=actor.id, before=before, after=after)

            updated += 1
        except (LifecycleError, ValueError) as exc:
            errors.append({"row": r["row"], "message": str(exc)})

    await session.flush()
    return {"updated": updated, "errors": errors}


async def _commit_add(
    session: AsyncSession, content: bytes, actor: AssetUser, allowed_company_ids: list[int] | None = None,
) -> dict:
    """Raises ImportScopeError (-> 403) if any row targets a company outside
    `allowed_company_ids`, before writing anything -- this part of the batch
    stays all-or-nothing, unchanged from before AM-06. Every other per-row
    problem -- including no active code rule for that row's company, a
    code-rule token that can't be resolved, or a lifecycle failure on any of
    a Quantity>1 row's units -- is reported as a single row error (never a
    500), and every OTHER valid row still commits: unchanged VALID-ROWS-ONLY
    semantics, now extended so a Quantity>1 row's several units share one
    savepoint (partial success within one row would leave orphaned sibling
    units with no way to explain to the user which ones "count"), so a
    mid-row failure discards that whole row's units, not just the failed one.
    """
    valid_rows, errors, scope_violations = await _validate_add_rows(session, content, allowed_company_ids)
    if scope_violations:
        raise ImportScopeError("; ".join(f"row {v['row']}: {v['message']}" for v in scope_violations))

    # Looked up per company (cached): applying one company's rule to every row
    # mis-codes a multi-company file.
    rules: dict[int, CodeRule | ValueError] = {}
    locations: dict[int, Location | None] = {}

    imported = 0
    for r in valid_rows:
        company_id = r["company"].id
        if company_id not in rules:
            try:
                rules[company_id] = await get_active_rule(session, company_id)
            except ValueError as exc:
                rules[company_id] = exc
        rule = rules[company_id]
        if isinstance(rule, ValueError):
            errors.append({"row": r["row"], "message": str(rule)})
            continue

        location_id = r["asset_user"].location_id
        if location_id not in locations:
            locations[location_id] = await session.get(Location, location_id)
        purchase_date = r["purchase_date"]
        tokens = build_code_tokens(
            company=r["company"], location=locations[location_id], cost_center=r["cost_center"],
            category=r["category"], subcategory=r["subcategory"], purchase_date=purchase_date,
        )
        tax_amount, total_cost = compute_tax(r["purchase_cost"], r["tax_percent"])
        event_date = datetime.combine(purchase_date, datetime.min.time()).replace(tzinfo=timezone.utc)

        try:
            # Every unit of this row's Quantity shares one SAVEPOINT: if any
            # unit's apply_event raises LifecycleError (e.g. a future-dated
            # row), rolling back just this savepoint discards every unit this
            # row would have created (and every generate_code counter
            # increment made inside it) without aborting the whole commit --
            # same per-item try/except pattern app.assets.router.bulk_move
            # already uses for apply_event failures, extended to cover a
            # whole row's units as one unit of retry for the user.
            async with session.begin_nested():
                for _ in range(r["quantity"]):
                    # Same global uniqueness rule Add Asset/PO delivery enforce
                    # (docs/ai/DECISIONS.md) -- "N/A" (case-insensitive) is
                    # exempt, everything else must be unique system-wide.
                    await check_serial_number_unique(session, r["serial_number"])
                    code = await generate_code(session, rule, tokens)
                    asset = Asset(
                        asset_code=code, legacy_asset_code=r["legacy_asset_code"], company_id=r["company"].id,
                        cost_center_id=r["cost_center"].id, category_id=r["category"].id,
                        subcategory_id=r["subcategory"].id if r["subcategory"] else None,
                        brand_id=r["brand"].id if r["brand"] else None, model=r["model"], serial_number=r["serial_number"],
                        description=r["description"],
                        vendor_id=r["vendor"].id if r["vendor"] else None,
                        po_number=r["po_number"], po_date=r["po_date"],
                        invoice_number=r["invoice_number"], invoice_date=r["invoice_date"],
                        invoice_amount=r["invoice_amount"],
                        pi_number=r["pi_number"], pi_date=r["pi_date"],
                        purchase_cost=Decimal(str(r["purchase_cost"])), tax_percent=Decimal(str(r["tax_percent"])),
                        tax_amount=tax_amount, total_cost=total_cost,
                        purchase_date=purchase_date, warranty_years=r["warranty_years"],
                        warranty_upto=compute_warranty_upto(purchase_date, r["warranty_years"]),
                        # Initial status set directly here, not through apply_event -- the same
                        # documented exception app.assets.service.procure_assets uses: a freshly
                        # inserted row needs a non-null status/asset_user before the state machine has
                        # anything to transition from. apply_event, called immediately below,
                        # derives and writes the real post-import status from the asset_user's type.
                        status="IN_STOCK",
                        current_asset_user_id=r["asset_user"].id, status_since=purchase_date,
                        custom_fields=r["custom_fields"],
                        created_by=actor.id, updated_by=actor.id,
                    )
                    session.add(asset)
                    await session.flush()
                    await apply_event(
                        session, asset, "IMPORTED", to_asset_user_id=r["asset_user"].id, actor=actor,
                        event_date=event_date,
                        remarks=f"Imported from legacy code {r['legacy_asset_code']}" if r["legacy_asset_code"] else "Imported",
                    )
            imported += r["quantity"]
        except (LifecycleError, ValueError) as exc:
            # ValueError: resolve_prefix/generate_code rejected the rule for this row
            # (unknown or empty token); the savepoint rollback discards every unit.
            errors.append({"row": r["row"], "message": str(exc)})

    await session.flush()
    return {"imported": imported, "errors": errors}


async def commit_import(
    session: AsyncSession, content: bytes, actor: AssetUser, allowed_company_ids: list[int] | None = None, mode: str = "add",
) -> dict:
    if mode == "edit":
        return await _commit_edit(session, content, actor, allowed_company_ids)
    return await _commit_add(session, content, actor, allowed_company_ids)
