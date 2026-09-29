"""AM-25: a generic, config-driven bulk Import/Export engine, reused by
every master (Companies/Locations/Departments/Cost Centres/Categories/
Sub-Categories/Vendors -- wired in via `build_master_router` in
app.masters.router) and by Holders (app.holders.router, which imports this
module directly). One engine instead of nine bespoke ones, matching this
codebase's existing "generalize the CRUD router, don't repeat it" pattern
(see `build_master_router` itself).

Deliberately CREATE-ONLY (no bulk edit-by-code mode, unlike Import's own
Asset Add/Edit split) -- master rows are small and few enough that ordinary
Edit already covers corrections; bulk import here is for the "I have 40
cost centres in a spreadsheet already" case.

Column headers are looked up by name from the workbook's own header row --
not positional -- exactly like app.imports.asset_import_service, for the
same reason (column order in an uploaded file must never matter).
"""
from dataclasses import dataclass, field
from datetime import date, datetime
from io import BytesIO
import openpyxl
from sqlalchemy import select
from sqlalchemy.exc import DataError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.reports.export_service import _sanitize_row


@dataclass
class FieldSpec:
    """One column, both for the template/import parser and for export.

    `field`: the target model attribute name.
    `lookup`: (Model, code_attribute) -- when set, the cell holds that
      other master's code (or, for Department, its name -- there is no
      separate code column), resolved to an id for `field`. Export reverses
      this: the id in `field` is looked up and its `code_attribute` shown
      instead of the bare id, so a re-exported file can be re-imported
      unchanged.
    `kind`: "text" | "int" | "float" | "bool" | "enum" -- ignored when
      `lookup` is set (a lookup always resolves to an int id).
    `scope_by`: when set, the lookup is additionally filtered to
      `{scope_by: data[scope_by]}` -- for a lookup target whose own code is
      only unique *within* another already-resolved field (e.g. Location's
      code is unique per company, not globally, so "Location Code" must be
      resolved scoped to this row's own already-looked-up company_id).
      `scope_by` must name a field that an earlier FieldSpec in the same
      list already resolved (column order in the list matters here, unlike
      everywhere else in this module).
    """
    header: str
    field: str
    required: bool = False
    lookup: tuple[type, str] | None = None
    kind: str = "text"
    enum_values: tuple[str, ...] = ()
    max_length: int | None = None
    scope_by: str | None = None


class ImportTemplateError(ValueError):
    """The workbook itself is malformed (missing a required column) -- a
    file-level problem, not a row-level one."""


class ImportScopeError(PermissionError):
    """The file targets at least one company outside the importing actor's scope."""


def _is_blank(value) -> bool:
    return value is None or (isinstance(value, str) and value.strip() == "")


def _read_header(ws) -> dict[str, int]:
    try:
        header_row = next(ws.iter_rows(min_row=1, max_row=1, values_only=True))
    except StopIteration:
        return {}
    return {str(h).strip(): idx for idx, h in enumerate(header_row) if h is not None and str(h).strip() != ""}


async def _lookup(session: AsyncSession, model, **filters):
    stmt = select(model)
    for key, value in filters.items():
        stmt = stmt.where(getattr(model, key) == value)
    return (await session.execute(stmt)).scalars().first()


def build_template(fields: list[FieldSpec]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append([f.header for f in fields])
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def export_rows(
    session: AsyncSession, model, fields: list[FieldSpec],
    allowed_company_ids: list[int] | None, company_field: str | None,
) -> bytes:
    """`company_field` is the model's own company-scoping attribute name
    ("company_id" for a company-owned master, "id" for the Companies master
    itself, None for a global master) -- mirrors
    app.masters.router.SCOPE_COMPANY_ID/SCOPE_SELF/SCOPE_NONE without
    importing that router module (would be a cross-import back into the
    thing that imports this one)."""
    stmt = select(model).where(model.is_active.is_(True))
    if company_field is not None and allowed_company_ids is not None:
        stmt = stmt.where(getattr(model, company_field).in_(allowed_company_ids))
    rows = (await session.execute(stmt)).scalars().all()

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append([f.header for f in fields])

    # Batch id->code lookups per lookup-field, same page-scoped-cache
    # discipline as app.assets.router._page_label_maps -- never a per-row query.
    lookup_caches: dict[str, dict[int, str | None]] = {}
    for f in fields:
        if f.lookup is not None:
            lookup_model, lookup_attr = f.lookup
            ids = {getattr(r, f.field) for r in rows if getattr(r, f.field) is not None}
            if ids:
                found = (await session.execute(
                    select(lookup_model.id, getattr(lookup_model, lookup_attr)).where(lookup_model.id.in_(ids))
                )).all()
                lookup_caches[f.field] = {row[0]: row[1] for row in found}
            else:
                lookup_caches[f.field] = {}

    for r in rows:
        line = []
        for f in fields:
            value = getattr(r, f.field)
            if f.lookup is not None:
                line.append(lookup_caches[f.field].get(value) if value is not None else None)
            elif isinstance(value, (date, datetime)):
                line.append(value.isoformat())
            else:
                line.append(value)
        ws.append(_sanitize_row(line))

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def _validate_rows(
    session: AsyncSession, fields: list[FieldSpec], content: bytes,
    allowed_company_ids: list[int] | None, company_field: str | None,
) -> tuple[list[dict], list[dict], list[dict]]:
    wb = openpyxl.load_workbook(BytesIO(content))
    ws = wb.active
    header = _read_header(ws)

    missing = [f.header for f in fields if f.required and f.header not in header]
    if missing:
        raise ImportTemplateError(f"missing required column(s): {', '.join(missing)} -- re-download the template")

    valid_rows: list[dict] = []
    errors: list[dict] = []
    scope_violations: list[dict] = []

    for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if row is None or all(v is None for v in row):
            continue

        def cell(name: str):
            idx = header.get(name)
            return row[idx] if idx is not None and idx < len(row) else None

        data: dict = {}
        row_error = False
        for f in fields:
            raw = cell(f.header)
            if _is_blank(raw):
                if f.required:
                    errors.append({"row": row_idx, "field": f.header, "message": f"{f.header} is required"})
                    row_error = True
                    break
                data[f.field] = None
                continue
            if f.lookup is not None:
                lookup_model, lookup_attr = f.lookup
                filters = {lookup_attr: raw}
                if f.scope_by is not None:
                    filters[f.scope_by] = data.get(f.scope_by)
                obj = await _lookup(session, lookup_model, **filters)
                if obj is None:
                    errors.append({"row": row_idx, "field": f.header, "message": f"unknown {f.header} '{raw}'"})
                    row_error = True
                    break
                data[f.field] = obj.id
            elif f.kind == "int":
                try:
                    data[f.field] = int(raw)
                except (TypeError, ValueError):
                    errors.append({"row": row_idx, "field": f.header, "message": f"{f.header} '{raw}' must be a whole number"})
                    row_error = True
                    break
            elif f.kind == "float":
                try:
                    data[f.field] = float(raw)
                except (TypeError, ValueError):
                    errors.append({"row": row_idx, "field": f.header, "message": f"{f.header} '{raw}' must be a number"})
                    row_error = True
                    break
            elif f.kind == "bool":
                text = str(raw).strip().lower()
                if text in ("true", "yes", "1"):
                    data[f.field] = True
                elif text in ("false", "no", "0"):
                    data[f.field] = False
                else:
                    errors.append({"row": row_idx, "field": f.header, "message": f"{f.header} must be true/false (or yes/no, 1/0)"})
                    row_error = True
                    break
            elif f.kind == "enum":
                text = str(raw).strip()
                if text not in f.enum_values:
                    errors.append({"row": row_idx, "field": f.header, "message": f"{f.header} must be one of {', '.join(f.enum_values)}"})
                    row_error = True
                    break
                data[f.field] = text
            else:
                text = str(raw).strip()
                if f.max_length is not None and len(text) > f.max_length:
                    errors.append({
                        "row": row_idx, "field": f.header,
                        "message": f"{f.header} must be {f.max_length} characters or fewer (got {len(text)})",
                    })
                    row_error = True
                    break
                data[f.field] = text
        if row_error:
            continue

        if company_field is not None and allowed_company_ids is not None:
            # SCOPE_SELF (the Companies master itself, company_field="id"):
            # a brand-new company is by definition outside any non-ADMIN's
            # scope -- matches app.masters.router.create_item's own rule.
            # SCOPE_COMPANY_ID: the row's own resolved company_id must be
            # one of the caller's allowed companies.
            in_scope = False if company_field == "id" else data.get(company_field) in allowed_company_ids
            if not in_scope:
                violation = {"row": row_idx, "message": "outside your company scope"}
                errors.append(violation)
                scope_violations.append(violation)
                continue

        valid_rows.append({"row": row_idx, "data": data})

    return valid_rows, errors, scope_violations


async def preview_import(
    session: AsyncSession, fields: list[FieldSpec], content: bytes,
    allowed_company_ids: list[int] | None, company_field: str | None,
) -> dict:
    valid_rows, errors, _ = await _validate_rows(session, fields, content, allowed_company_ids, company_field)
    return {
        "valid_rows": [{"row": r["row"], "values": {f.header: r["data"].get(f.field) for f in fields}} for r in valid_rows],
        "errors": errors,
    }


async def commit_import(
    session: AsyncSession, model, fields: list[FieldSpec], content: bytes, actor,
    allowed_company_ids: list[int] | None, company_field: str | None,
) -> dict:
    valid_rows, errors, scope_violations = await _validate_rows(session, fields, content, allowed_company_ids, company_field)
    if scope_violations:
        raise ImportScopeError(f"{len(scope_violations)} row(s) target a company outside your scope")

    imported = 0
    for r in valid_rows:
        try:
            async with session.begin_nested():
                obj = model(**r["data"], created_by=actor.id, updated_by=actor.id)
                session.add(obj)
                await session.flush()
            imported += 1
        except IntegrityError:
            errors.append({"row": r["row"], "message": "a record with this code already exists"})
        except DataError:
            # Defense-in-depth: a row-level DB error that field-level
            # validation above didn't already catch (e.g. an unforeseen
            # column constraint) reports as a per-row error, not a 500 that
            # kills every other valid row in the same file.
            errors.append({"row": r["row"], "message": "this row could not be saved -- one of its values is invalid"})

    await session.flush()
    return {"imported": imported, "errors": errors}
