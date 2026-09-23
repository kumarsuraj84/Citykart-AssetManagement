from datetime import datetime, timezone
from io import BytesIO
import openpyxl
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.holders.models import Holder
from app.lifecycle.service import apply_event
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter
from app.numbering.service import generate_code, get_active_rule
from app.assets.models import Asset

TEMPLATE_COLUMNS = [
    "legacy_asset_code", "company_code", "cost_center_code", "category_code",
    "subcategory_code", "description", "purchase_date", "holder_emp_code",
]


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


async def _validate_rows(session: AsyncSession, content: bytes) -> tuple[list[dict], list[dict]]:
    wb = openpyxl.load_workbook(BytesIO(content))
    ws = wb.active
    valid_rows: list[dict] = []
    errors: list[dict] = []

    for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if row is None or all(v is None for v in row):
            continue
        legacy_code, company_code, cc_code, cat_code, sub_code, description, purchase_date, holder_code = row

        company = await _lookup(session, Company, code=company_code)
        if company is None:
            errors.append({"row": row_idx, "message": f"unknown company_code '{company_code}'"})
            continue
        cost_center = await _lookup(session, CostCenter, company_id=company.id, code=cc_code)
        if cost_center is None:
            errors.append({"row": row_idx, "message": f"unknown cost_center_code '{cc_code}'"})
            continue
        category = await _lookup(session, AssetCategory, code=cat_code)
        if category is None:
            errors.append({"row": row_idx, "message": f"unknown category_code '{cat_code}'"})
            continue
        subcategory = await _lookup(session, AssetSubcategory, category_id=category.id, code=sub_code)
        if subcategory is None:
            errors.append({"row": row_idx, "message": f"unknown subcategory_code '{sub_code}' for category '{cat_code}'"})
            continue
        holder = await _lookup(session, Holder, company_id=company.id, emp_code=holder_code)
        if holder is None:
            errors.append({"row": row_idx, "message": f"unknown holder_emp_code '{holder_code}'"})
            continue
        if not description:
            errors.append({"row": row_idx, "message": "description is required"})
            continue

        valid_rows.append({
            "row": row_idx, "legacy_asset_code": legacy_code, "company": company, "cost_center": cost_center,
            "category": category, "subcategory": subcategory, "description": description,
            "purchase_date": purchase_date, "holder": holder,
        })

    return valid_rows, errors


async def preview_import(session: AsyncSession, content: bytes) -> dict:
    valid_rows, errors = await _validate_rows(session, content)
    return {
        "valid_rows": [{"row": r["row"], "legacy_asset_code": r["legacy_asset_code"], "description": r["description"]} for r in valid_rows],
        "errors": errors,
    }


async def commit_import(session: AsyncSession, content: bytes, actor: Holder) -> dict:
    valid_rows, errors = await _validate_rows(session, content)
    rule = await get_active_rule(session, valid_rows[0]["company"].id) if valid_rows else None

    imported = 0
    for r in valid_rows:
        tokens = {
            "cost_center.code": r["cost_center"].code, "category.code": r["category"].code,
            "subcategory.code": r["subcategory"].code, "company.code": r["company"].code, "location.code": "",
            "yyyy": "", "yy": "", "mm": "",
        }
        code = await generate_code(session, rule, tokens)
        purchase_date = r["purchase_date"]
        if isinstance(purchase_date, str):
            purchase_date = datetime.strptime(purchase_date, "%Y-%m-%d").date()
        elif hasattr(purchase_date, "date"):
            purchase_date = purchase_date.date()

        asset = Asset(
            asset_code=code, legacy_asset_code=r["legacy_asset_code"], company_id=r["company"].id,
            cost_center_id=r["cost_center"].id, category_id=r["category"].id, subcategory_id=r["subcategory"].id,
            description=r["description"], purchase_date=purchase_date,
            # Initial status set directly here, not through apply_event -- this is the same
            # documented exception used by app.assets.service.procure_assets: a freshly
            # inserted row needs a non-null status/holder before the state machine has
            # anything to transition from. apply_event is called immediately below to
            # record the IMPORTED ledger event and is the sole writer for every
            # transition after this one.
            status=_status_for_holder_type(r["holder"].holder_type),
            current_holder_id=r["holder"].id, status_since=purchase_date,
            created_by=actor.id, updated_by=actor.id,
        )
        session.add(asset)
        await session.flush()
        await apply_event(
            session, asset, "IMPORTED", to_holder_id=r["holder"].id, actor=actor,
            event_date=datetime.combine(purchase_date, datetime.min.time()).replace(tzinfo=timezone.utc),
            remarks=f"Imported from legacy code {r['legacy_asset_code']}",
        )
        imported += 1

    await session.flush()
    return {"imported": imported, "errors": errors}


def _status_for_holder_type(holder_type: str) -> str:
    return {"EMPLOYEE": "ALLOTTED", "STORE": "ALLOTTED", "INSTALLED": "INSTALLED", "IT_STOCK": "IN_STOCK"}[holder_type]
