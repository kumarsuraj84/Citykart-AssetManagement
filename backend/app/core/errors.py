"""S0.7: app-wide exception handlers, so no endpoint answers a bare 500 (or a raw
validation array) for a problem with the request itself.

* FastAPI's request-validation errors become one readable sentence per problem.
  `detail` stays a STRING (the frontend's api-client only shows a string
  `detail`), the sentences joined by a space; the same sentences are also given
  as a list in the additive `errors` field. HTTP status stays 422.
* LifecycleError (an illegal asset movement) -> 422 with its message.
* IntegrityError -> 409 for "already exists", 422 for a reference to a record
  that does not exist (naming the field in words), never the database text.
* DataError (text too long for its column, a number too big, a NUL character)
  and any other SQLAlchemy statement error -> 422 with a plain sentence.
"""
from __future__ import annotations

import logging
import re

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DataError, IntegrityError, InterfaceError, OperationalError, StatementError

from app.lifecycle.state_machine import LifecycleError

logger = logging.getLogger("ckam.errors")

# Field names as people say them. Anything not listed is derived from the
# name itself ("purchase_cost" -> "Purchase cost", "vendor_id" -> "Vendor").
FIELD_LABELS: dict[str, str] = {
    "po_number": "PO number",
    "po_date": "PO date",
    "pi_number": "PI number",
    "pi_date": "PI date",
    "gstin": "GSTIN",
    "erp_po_code": "ERP purchase order",
    "erp_company_code": "ERP company code",
    "erp_vendor_code": "ERP supplier code",
    "item_code": "ERP item code",
    "asset_ids": "assets",
    "to_asset_user_id": "Destination",
    "initial_asset_user_id": "Received into",
    "delivery_asset_user_id": "Delivery location",
    "pending_asset_id": "PO unit",
    "cost_center_id": "Cost centre",
    "tax_percent": "Tax %",
    "asset_user_type": "Type",
    "asset_domain": "Work area (IT / Non-IT)",
    "allowed_asset_domains": "Work area",
    "primary_asset_domain": "Default work area",
    "subcategory_id": "Sub-category",
    "category_id": "Category",
    "item_id": "Item",
    "brand_id": "Brand",
    "vendor_id": "Vendor",
    "company_id": "Company",
    "location_id": "Location",
    "department_id": "Department",
    "bundle_id": "Bundle",
    "prefix_template": "Code format",
    "suffix_template": "Code ending",
    "start_number": "Starting number",
    "pad_width": "Number of digits",
    "legacy_asset_code": "Old asset code",
    "serial_number": "Serial number",
    "serials": "serial numbers",
    "codes": "store codes",
    "company_ids": "companies",
    "lines": "lines",
    "new_password": "New password",
    "old_password": "Current password",
    "login_id": "Login",
    "q": "Search text",
}


def field_label(name: str) -> str:
    if name in FIELD_LABELS:
        label = FIELD_LABELS[name]
    else:
        base = name[:-3] if name.endswith("_id") else name
        label = base.replace("_", " ").strip()
    return label[:1].upper() + label[1:] if label else "This value"


def _num(value) -> str:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return str(value)
    return f"{int(f):,}" if f.is_integer() else f"{f:g}"


def _sentence(text: str) -> str:
    text = text.strip()
    if not text:
        return text
    text = text[:1].upper() + text[1:]
    return text if text.endswith((".", "!", "?")) else text + "."


def describe_error(err: dict) -> str:
    """One plain sentence for one pydantic/FastAPI validation error."""
    loc = [part for part in err.get("loc", ()) if part not in ("body", "query", "path", "header", "cookie", "form")]
    kind = err.get("type", "")
    ctx = err.get("ctx") or {}
    msg = str(err.get("msg", ""))

    # "lines.2.quantity" -> prefix "Line 3: "
    prefix = ""
    field = None
    for i, part in enumerate(loc):
        if isinstance(part, int):
            parent = loc[i - 1] if i > 0 else None
            noun = "Line" if parent == "lines" else "Entry"
            prefix = f"{noun} {part + 1}: "
        elif isinstance(part, str):
            field = part
    if field is not None and field in ("lines",) and loc and isinstance(loc[-1], int):
        field = None
    label = field_label(field) if field else None

    if kind in ("value_error", "assertion_error"):
        text = re.sub(r"^(Value error|Assertion failed),\s*", "", msg)
        return prefix + _sentence(text)
    if label is None:
        if kind == "json_invalid":
            return "The request could not be read. Check the values and try again."
        if kind in ("model_type", "model_attributes_type", "dict_type"):
            return "The request is missing its details."
        return prefix + _sentence(msg)
    if kind == "missing":
        return prefix + f"{label} is required."
    if kind == "string_too_long":
        return prefix + f"{label} is too long (max {_num(ctx.get('max_length'))} characters)."
    if kind == "string_too_short":
        if ctx.get("min_length") in (1, None):
            return prefix + f"{label} cannot be blank."
        return prefix + f"{label} is too short (at least {_num(ctx.get('min_length'))} characters)."
    if kind == "too_long":
        if field and field.endswith("ids") or field in ("serials", "codes", "lines", "items"):
            return prefix + f"You can choose at most {_num(ctx.get('max_length'))} {label.lower()} at a time."
        return prefix + f"{label} can have at most {_num(ctx.get('max_length'))} entries."
    if kind == "too_short":
        if field == "lines":
            return prefix + "Add at least one line."
        return prefix + f"{label} needs at least {_num(ctx.get('min_length'))} entry."
    if kind == "greater_than_equal":
        return prefix + f"{label} must be at least {_num(ctx.get('ge'))}."
    if kind == "greater_than":
        return prefix + f"{label} must be more than {_num(ctx.get('gt'))}."
    if kind == "less_than_equal":
        return prefix + f"{label} must be at most {_num(ctx.get('le'))}."
    if kind == "less_than":
        return prefix + f"{label} must be less than {_num(ctx.get('lt'))}."
    if kind in ("int_parsing", "int_type", "int_from_float", "float_parsing", "float_type", "decimal_parsing",
                "decimal_type", "finite_number"):
        return prefix + f"{label} must be a number."
    if kind.startswith("date") or kind.startswith("datetime"):
        return prefix + f"{label} must be a valid date."
    if kind.startswith("bool"):
        return prefix + f"{label} must be yes or no."
    if kind in ("string_type",):
        return prefix + f"{label} must be text."
    if kind in ("list_type",):
        return prefix + f"{label} must be a list."
    if kind in ("literal_error", "enum"):
        return prefix + f"{label} must be one of: {ctx.get('expected', '')}."
    if kind == "string_pattern_mismatch":
        return prefix + f"{label} is not in the expected format."
    if kind == "extra_forbidden":
        return prefix + f"{label} is not expected here."
    return prefix + f"{label}: {_sentence(msg)}"


def validation_messages(errors: list[dict]) -> list[str]:
    out: list[str] = []
    for err in errors:
        sentence = describe_error(err)
        if sentence and sentence not in out:
            out.append(sentence)
    return out or ["Some of the values are not valid. Check them and try again."]


# S7: unique indexes on expressions (their key text is not a plain column list) -> their own sentence.
CONSTRAINT_MESSAGES = {
    "uq_purchase_order_company_number_active": "A purchase order with this PO number already exists for this company.",
}

_FK_DETAIL_RE = re.compile(r"Key \((?P<col>[a-z_]+)\)=\((?P<val>[^)]*)\) is not present in table")
_UNIQUE_DETAIL_RE = re.compile(r"Key \((?P<cols>[^)]*)\)=")


def _pg_error(exc: Exception):
    """The asyncpg exception under SQLAlchemy's wrapper, if any."""
    orig = getattr(exc, "orig", None)
    cause = getattr(orig, "__cause__", None)
    return cause if cause is not None else orig


def integrity_message(exc: IntegrityError) -> tuple[int, str]:
    pg = _pg_error(exc)
    sqlstate = getattr(pg, "sqlstate", None) or getattr(getattr(exc, "orig", None), "pgcode", None)
    detail = getattr(pg, "detail", None) or str(getattr(exc, "orig", ""))
    if sqlstate == "23503":                                   # foreign key
        m = _FK_DETAIL_RE.search(detail or "")
        if m:
            return status.HTTP_422_UNPROCESSABLE_ENTITY, f"The {field_label(m.group('col')).lower()} you chose does not exist."
        return status.HTTP_422_UNPROCESSABLE_ENTITY, "One of the records you chose does not exist (or is still in use)."
    if sqlstate == "23505":                                   # unique
        constraint = getattr(pg, "constraint_name", None) or ""
        if constraint in CONSTRAINT_MESSAGES:
            return status.HTTP_409_CONFLICT, CONSTRAINT_MESSAGES[constraint]
        m = _UNIQUE_DETAIL_RE.search(detail or "")
        if m:
            cols = [c.strip() for c in m.group("cols").split(",")]
            named = [field_label(c).lower() for c in cols if c not in ("company_id", "category_id")] or ["value"]
            return status.HTTP_409_CONFLICT, f"A record with this {' and '.join(named)} already exists."
        return status.HTTP_409_CONFLICT, "This record already exists."
    if sqlstate == "23502":                                   # not null
        col = getattr(pg, "column_name", None)
        if col:
            return status.HTTP_422_UNPROCESSABLE_ENTITY, f"{field_label(col)} is required."
        return status.HTTP_422_UNPROCESSABLE_ENTITY, "A required value is missing."
    return status.HTTP_422_UNPROCESSABLE_ENTITY, "These values could not be saved together. Check them and try again."


def data_error_message(exc: Exception) -> str:
    text = str(getattr(exc, "orig", exc)).lower()
    m = re.search(r"character varying\((\d+)\)", text)
    if "too long" in text and m:
        return f"One of the texts is too long (max {m.group(1)} characters)."
    if "numeric field overflow" in text or "out of range" in text or "out of int" in text:
        return "One of the numbers is too large."
    if "0x00" in text or "invalid byte sequence" in text or "null character" in text:
        return "Text cannot contain hidden control characters. Remove them and try again."
    if "invalid input" in text or "invalid" in text:
        return "One of the values is not in a valid format."
    return "Some of the values could not be saved. Check them and try again."


async def _validation_handler(_request: Request, exc: RequestValidationError):
    messages = validation_messages(list(exc.errors()))
    return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        content={"detail": " ".join(messages), "errors": messages})


async def _lifecycle_handler(_request: Request, exc: LifecycleError):
    return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, content={"detail": str(exc)})


async def _integrity_handler(request: Request, exc: IntegrityError):
    code, message = integrity_message(exc)
    logger.info("integrity error on %s %s: %s", request.method, request.url.path, getattr(exc, "orig", exc))
    return JSONResponse(status_code=code, content={"detail": message})


async def _data_handler(request: Request, exc: DataError):
    logger.info("data error on %s %s: %s", request.method, request.url.path, getattr(exc, "orig", exc))
    return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, content={"detail": data_error_message(exc)})


async def _statement_handler(request: Request, exc: StatementError):
    if isinstance(exc, (OperationalError, InterfaceError)):
        logger.error("database unavailable on %s %s: %s", request.method, request.url.path, exc)
        return JSONResponse(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            content={"detail": "The database could not be reached. Try again in a moment."})
    logger.warning("statement error on %s %s: %s", request.method, request.url.path, exc)
    # asyncpg reports some bad values (a NUL character, an id too big for its
    # column) as a plain driver error rather than a DataError: same answers.
    return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, content={"detail": data_error_message(exc)})


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(RequestValidationError, _validation_handler)
    app.add_exception_handler(LifecycleError, _lifecycle_handler)
    app.add_exception_handler(IntegrityError, _integrity_handler)
    app.add_exception_handler(DataError, _data_handler)
    app.add_exception_handler(StatementError, _statement_handler)
