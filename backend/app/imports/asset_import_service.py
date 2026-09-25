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
"""
from datetime import date, datetime, timezone
from decimal import Decimal
from io import BytesIO
import openpyxl
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.assets.custom_field_values import applicable_custom_fields, validate_custom_field_values
from app.assets.service import check_serial_number_unique, compute_tax
from app.holders.models import Holder
from app.lifecycle.service import apply_event
from app.lifecycle.state_machine import LifecycleError
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Location, Vendor
from app.numbering.models import CodeRule
from app.numbering.service import build_code_tokens, generate_code, get_active_rule
from app.assets.models import Asset

# Exact column-name contract -- see docs/ai/DECISIONS.md for the full table
# (backend mapping, format, requiredness, lookup rule). Order here is only
# the order `build_template` writes them in; parsing below is by header
# name, not position, so an uploaded file's column order never matters.
TEMPLATE_COLUMNS = [
    "Company Code", "Cost Centre Code", "Category Code", "Subcategory Code",
    "Description", "Legacy Asset Code", "Purchase Date",
    "Vendor Code", "PO Number", "PO Date", "Invoice Number", "Invoice Date",
    "PI Number", "PI Date", "Purchase Cost", "Tax %",
    "Brand", "Model", "Serial Number", "Warranty Upto",
    "Initial Holder Code", "Quantity",
]

# Columns without which a row can never be validated -- checked against the
# workbook's header row once, before any row is even read, so a malformed
# template produces one clear file-level error instead of nonsense per-row
# "unknown company_code 'None'" noise.
REQUIRED_COLUMNS = [
    "Company Code", "Cost Centre Code", "Category Code", "Description",
    "Purchase Date", "Initial Holder Code",
]

# Any header starting with this prefix is a Custom Field value column; the
# part after it is the field's stable `field_key` (never its display
# label -- a label rename must never break a saved spreadsheet). See
# docs/ai/DECISIONS.md for the full convention.
CUSTOM_FIELD_PREFIX = "Custom:"


def build_template() -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(TEMPLATE_COLUMNS)
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


def _parse_purchase_date(value) -> date:
    """Required -- shared by `_validate_rows` (so both preview and commit apply the exact
    same rule) rather than left for commit to parse on its own -- a malformed date used to
    pass preview as "valid" and then raise an uncaught ValueError inside the commit loop,
    silently 500-ing a request that preview had just told the caller was clean."""
    if _is_blank(value):
        raise ValueError("Purchase Date is required")
    return _parse_date_value(value, "Purchase Date")


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


def _parse_optional_number(value, label: str) -> float:
    if _is_blank(value):
        return 0.0
    if isinstance(value, bool):
        raise ValueError(f"{label} must be a number")
    try:
        return float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} '{value}' must be a number")


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


def _out_of_scope_message(company_code) -> str:
    return f"Company Code '{company_code}' is outside your company scope"


def _read_header(ws) -> dict[str, int]:
    try:
        header_row = next(ws.iter_rows(min_row=1, max_row=1, values_only=True))
    except StopIteration:
        return {}
    return {str(h).strip(): idx for idx, h in enumerate(header_row) if h is not None and str(h).strip() != ""}


async def _validate_rows(
    session: AsyncSession, content: bytes, allowed_company_ids: list[int] | None = None,
) -> tuple[list[dict], list[dict], list[dict]]:
    """Returns (valid_rows, errors, scope_violations). `allowed_company_ids` is the
    actor's `scoped_company_ids` (None = ADMIN, unrestricted); a row whose company
    is outside it is never valid, and is also reported in `scope_violations` so
    commit can refuse the whole file (403) rather than quietly skip it."""
    wb = openpyxl.load_workbook(BytesIO(content))
    ws = wb.active
    header = _read_header(ws)

    missing = [c for c in REQUIRED_COLUMNS if c not in header]
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

        # Optional, same as Add Asset's own Sub-Category field -- a blank cell
        # means "no sub-category", not a validation error.
        sub_code = cell("Subcategory Code")
        subcategory = None
        if not _is_blank(sub_code):
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

        try:
            purchase_date = _parse_purchase_date(cell("Purchase Date"))
        except ValueError as exc:
            errors.append({"row": row_idx, "field": "Purchase Date", "message": str(exc)})
            continue

        holder_code = cell("Initial Holder Code")
        holder = await _lookup(session, Holder, company_id=company.id, emp_code=holder_code)
        if holder is None:
            errors.append({"row": row_idx, "field": "Initial Holder Code", "message": f"unknown Initial Holder Code '{holder_code}'"})
            continue

        try:
            quantity = _parse_quantity(cell("Quantity"))
        except ValueError as exc:
            errors.append({"row": row_idx, "field": "Quantity", "message": str(exc)})
            continue

        vendor = None
        vendor_code = cell("Vendor Code")
        if not _is_blank(vendor_code):
            vendor = await _lookup(session, Vendor, code=vendor_code)
            if vendor is None:
                errors.append({"row": row_idx, "field": "Vendor Code", "message": f"unknown Vendor Code '{vendor_code}'"})
                continue

        try:
            po_date = _parse_optional_date(cell("PO Date"), "PO Date")
            invoice_date = _parse_optional_date(cell("Invoice Date"), "Invoice Date")
            pi_date = _parse_optional_date(cell("PI Date"), "PI Date")
            warranty_upto = _parse_optional_date(cell("Warranty Upto"), "Warranty Upto")
        except ValueError as exc:
            errors.append({"row": row_idx, "message": str(exc)})
            continue

        try:
            purchase_cost = _parse_optional_number(cell("Purchase Cost"), "Purchase Cost")
            tax_percent = _parse_optional_number(cell("Tax %"), "Tax %")
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
            "description": description, "purchase_date": purchase_date, "holder": holder,
            "quantity": quantity, "vendor": vendor,
            "po_number": cell("PO Number"), "po_date": po_date,
            "invoice_number": cell("Invoice Number"), "invoice_date": invoice_date,
            "pi_number": cell("PI Number"), "pi_date": pi_date,
            "purchase_cost": purchase_cost, "tax_percent": tax_percent,
            "brand": cell("Brand"), "model": cell("Model"), "serial_number": cell("Serial Number"),
            "warranty_upto": warranty_upto, "custom_fields": custom_values,
        })

    return valid_rows, errors, scope_violations


async def preview_import(session: AsyncSession, content: bytes, allowed_company_ids: list[int] | None = None) -> dict:
    valid_rows, errors, _ = await _validate_rows(session, content, allowed_company_ids)
    return {
        "valid_rows": [
            {
                "row": r["row"], "legacy_asset_code": r["legacy_asset_code"],
                "company": r["company"].name, "category": r["category"].name,
                "subcategory": r["subcategory"].name if r["subcategory"] else None,
                "description": r["description"], "holder": r["holder"].name, "quantity": r["quantity"],
            }
            for r in valid_rows
        ],
        "errors": errors,
    }


async def commit_import(
    session: AsyncSession, content: bytes, actor: Holder, allowed_company_ids: list[int] | None = None,
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
    valid_rows, errors, scope_violations = await _validate_rows(session, content, allowed_company_ids)
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

        location_id = r["holder"].location_id
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
                        brand=r["brand"], model=r["model"], serial_number=r["serial_number"],
                        description=r["description"],
                        vendor_id=r["vendor"].id if r["vendor"] else None,
                        po_number=r["po_number"], po_date=r["po_date"],
                        invoice_number=r["invoice_number"], invoice_date=r["invoice_date"],
                        pi_number=r["pi_number"], pi_date=r["pi_date"],
                        purchase_cost=Decimal(str(r["purchase_cost"])), tax_percent=Decimal(str(r["tax_percent"])),
                        tax_amount=tax_amount, total_cost=total_cost,
                        purchase_date=purchase_date, warranty_upto=r["warranty_upto"],
                        # Initial status set directly here, not through apply_event -- the same
                        # documented exception app.assets.service.procure_assets uses: a freshly
                        # inserted row needs a non-null status/holder before the state machine has
                        # anything to transition from. apply_event, called immediately below,
                        # derives and writes the real post-import status from the holder's type.
                        status="IN_STOCK",
                        current_holder_id=r["holder"].id, status_since=purchase_date,
                        custom_fields=r["custom_fields"],
                        created_by=actor.id, updated_by=actor.id,
                    )
                    session.add(asset)
                    await session.flush()
                    await apply_event(
                        session, asset, "IMPORTED", to_holder_id=r["holder"].id, actor=actor,
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
