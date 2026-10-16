from dataclasses import dataclass
from typing import Awaitable, Callable
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from app.core.validation import check_email, check_gstin
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.capabilities import (
    AREA_WORDS, TEAM_WORDS, ensure_company_for_create, ensure_domain_manage, ensure_work_area_change,
    require_domain_admin, require_head_office, require_small_create,
)
from app.core.codes import unique_code
from app.core.uploads import read_upload_bounded
from app.core.db import get_session
from app.core.deps import READ_ROLES, ensure_company_in_scope, get_current_asset_user, require_primary_owner, require_role, scoped_company_ids
from app.masters.bulk_import_export import (
    FieldSpec, ImportScopeError, ImportTemplateError,
    build_template as build_import_template, commit_import, export_rows, preview_import,
)
from app.masters.custom_fields_router import router as custom_fields_router
from app.masters.service import MasterCRUDService
from app.masters import audit, models, schemas
from app.observability import events as obs_events

router = APIRouter(prefix="/api/masters", tags=["masters"])

# How a master's rows map to a company, for write-scope checks (a non-ADMIN
# actor may only write company-owned rows inside their own company scope):
#   None         -- global master (categories, vendors, ...), no company check
#   "company_id" -- row owned by the company in its `company_id` column
#   "self"       -- the row IS a company (the companies master itself)
SCOPE_NONE = None
SCOPE_COMPANY_ID = "company_id"
SCOPE_SELF = "self"


async def _check_new_record(session: AsyncSession, model, data: dict) -> None:
    """S0.10 / S0.6 for a NEW master row: its code must be unique ignoring
    letter case and spaces within its scope (`it` next to `IT` was allowed);
    existing mixed-case rows are left as they are. Its parent (company,
    category) must exist and be active."""
    parent_scope = {}
    if "company_id" in data and hasattr(model, "company_id"):
        company = await session.get(models.Company, data["company_id"])
        if company is None or not company.is_active:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The company you chose does not exist or is no longer active.")
        parent_scope["company_id"] = data["company_id"]
    if "category_id" in data and model is models.AssetSubcategory:
        category = await session.get(models.AssetCategory, data["category_id"])
        if category is None or not category.is_active:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The category you chose does not exist or is no longer active.")
        parent_scope["category_id"] = data["category_id"]
    for field in ("code", "name"):
        if field not in data or not hasattr(model, field):
            continue
        if field == "name" and model is not models.Department:
            continue          # only a Department is identified by its name
        value = (data.get(field) or "").strip()
        data[field] = value
        stmt = select(model.id).where(func.lower(func.trim(getattr(model, field))) == value.lower())
        for key, parent_id in parent_scope.items():
            stmt = stmt.where(getattr(model, key) == parent_id)
        if (await session.execute(stmt.limit(1))).first() is not None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"A record with the {field} {value} already exists.")


@dataclass
class MasterPolicy:
    """S3a-1: who may create / edit / deactivate one master, and the extra
    checks (work area, company scope, code made from the name, duplicate
    names, audit rows) that run before the write. The dependencies run before
    the body is read, so a login without the right gets 403 whatever it
    sends. Leaving a field out keeps the head-office-admin-only default."""
    create: Callable | None = None
    edit: Callable | None = None
    delete: Callable | None = None
    before_create: Callable[..., Awaitable[None]] | None = None    # (session, user, data)
    before_edit: Callable[..., Awaitable[None]] | None = None      # (session, user, existing, data)
    before_delete: Callable[..., Awaitable[None]] | None = None    # (session, user, existing)
    # S6: adds read-only figures to the rows of GET (e.g. item_count) -- (session, rows) -> rows
    annotate_list: Callable[..., Awaitable[list]] | None = None
    # Security RACE-1 residual: "brand" / "vendor" -- the Excel import refuses a row whose name an active record
    # (or an earlier row of the same file) already has, like adding one on the screen does.
    unique_name_noun: str | None = None


def build_master_router(
    prefix: str, model, schema_in, schema_out, company_scope: str | None = SCOPE_NONE,
    validate_incoming: Callable[[dict], None] | None = None,
    schema_edit=None,
    import_fields: list[FieldSpec] | None = None,
    policy: MasterPolicy | None = None,
):
    """`validate_incoming`, when given, is called with the request body's `model_dump()`
    on both create and update, before the row is written -- for closed-value fields a
    Pydantic `str` can't validate on its own. Raise ValueError to reject; the caller
    turns that into a clean 422, same convention as app.assets.service's ValueError
    usage.

    `schema_edit` (AM-05): the body schema for PUT, if narrower than `schema_in` --
    every master's immutable identifier (`code`) and controlled parent relationship
    (e.g. `company_id`) should never be freely editable after creation (see the
    Master Field Policy Matrix in docs/ai/AM-05_MASTERS_ASSET_USERS_REPORT.md). Falls
    back to `schema_in` when not given, so a master not yet given a narrower schema
    keeps its prior (full-`schema_in`) PUT behavior rather than breaking."""
    sub = APIRouter(prefix=prefix)
    edit_schema = schema_edit or schema_in
    policy = policy or MasterPolicy()
    create_dep = policy.create or require_primary_owner()
    edit_dep = policy.edit or require_primary_owner()
    delete_dep = policy.delete or require_primary_owner()

    async def check_existing(session: AsyncSession, asset_user, obj) -> None:
        if company_scope == SCOPE_COMPANY_ID:
            await ensure_company_in_scope(session, asset_user, obj.company_id)
        elif company_scope == SCOPE_SELF:
            await ensure_company_in_scope(session, asset_user, obj.id)

    async def check_incoming(session: AsyncSession, asset_user, data: dict) -> None:
        # AM-05: "company_id" in data -- when the PUT body uses a narrower
        # edit_schema that doesn't declare company_id at all (the normal
        # case now that it's immutable after creation), this check simply
        # doesn't apply: there's no incoming company_id to validate, because
        # the field can't be changed via this path regardless of role.
        if company_scope == SCOPE_COMPANY_ID and "company_id" in data:
            await ensure_company_in_scope(session, asset_user, data.get("company_id"))

    @sub.get("", response_model=list[schema_out])
    async def list_items(
        company_id: int | None = Query(None),
        session: AsyncSession = Depends(get_session),
        asset_user=Depends(require_role(*READ_ROLES)),     # security AC-1: staff roles only, not self-service logins
    ):
        # AM-08: an optional, opt-in filter for a company-owned master (Cost
        # Centres) -- a data-entry screen like Add Asset passes its own
        # company_id to see only its own rows. Omitted entirely (the Setup
        # screens' own usage, unchanged), every active row is still returned,
        # exactly as before -- this is a read-side narrowing, not a new
        # authorization boundary (writes were already, and remain, the actual
        # enforcement point). A company_id passed against a master that isn't
        # company-owned (company_scope is None) is harmless and ignored, since
        # that master has no such column to filter on.
        #
        # AM-17 DEF-03: a non-ADMIN staff member (IT_TEAM/VIEWER/ASSET_USER) could
        # previously omit company_id, or pass a different company's id, and
        # still see every company's Cost Centres -- the only enforcement was
        # on writes. Reads of a company-owned master are now always pinned to
        # the caller's own scope for a non-ADMIN, the same scope
        # ensure_company_in_scope already enforces for writes; any
        # client-supplied company_id outside that scope is silently narrowed,
        # not honored. ADMIN (scoped_company_ids() is None) is unaffected.
        filters = {}
        if company_scope == SCOPE_COMPANY_ID:
            allowed = await scoped_company_ids(session, asset_user)
            if allowed is None:
                if company_id is not None:
                    filters["company_id"] = company_id
            else:
                filters["company_id"] = company_id if company_id in allowed else allowed[0]
        rows = await MasterCRUDService(model, session).list_active(**filters)
        if policy.annotate_list is not None:
            return await policy.annotate_list(session, rows)
        return rows

    @sub.post("", response_model=schema_out, status_code=201)
    async def create_item(
        body: schema_in,
        session: AsyncSession = Depends(get_session),
        asset_user=Depends(create_dep),
    ):
        data = body.model_dump()
        if company_scope == SCOPE_SELF:
            # A brand-new company is by definition outside any non-ADMIN's scope.
            await ensure_company_in_scope(session, asset_user, None)
        if policy.before_create is not None:
            await policy.before_create(session, asset_user, data)
        await check_incoming(session, asset_user, data)
        if validate_incoming is not None:
            try:
                validate_incoming(data, None)
            except ValueError as exc:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
        await _check_new_record(session, model, data)
        try:
            return await MasterCRUDService(model, session).create(data, asset_user.id)
        except IntegrityError:
            # AM-09: every master has a unique `code` (some scoped, e.g. CostCenter's
            # (company_id, code)) -- a caller reusing an existing code is a completely
            # ordinary mistake (not malformed/adversarial input), and previously hit an
            # unhandled 500 (a raw asyncpg UniqueViolationError) instead of a normal
            # validation error. Rollback is required before the session can be used
            # again in this request (a failed INSERT leaves the transaction aborted).
            await session.rollback()
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A record with this code already exists.")

    @sub.put("/{item_id}", response_model=schema_out)
    async def update_item(
        item_id: int,
        body: edit_schema,
        session: AsyncSession = Depends(get_session),
        asset_user=Depends(edit_dep),
    ):
        service = MasterCRUDService(model, session)
        existing = await service.get(item_id)
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        data = body.model_dump()
        await check_existing(session, asset_user, existing)  # may not edit another company's row...
        await check_incoming(session, asset_user, data)      # ...nor move an own row into another company
        if policy.before_edit is not None:
            # work area / confirmation checks; adds its audit rows to the session
            # (committed together with the edit by service.update below)
            await policy.before_edit(session, asset_user, existing, data)
        if validate_incoming is not None:
            try:
                validate_incoming(data, existing)
            except ValueError as exc:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
        try:
            return await service.update(item_id, data, asset_user.id)
        except IntegrityError:
            await session.rollback()
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "A record with this name or code already exists.")

    @sub.delete("/{item_id}", status_code=204)
    async def deactivate_item(
        item_id: int,
        session: AsyncSession = Depends(get_session),
        asset_user=Depends(delete_dep),
    ):
        service = MasterCRUDService(model, session)
        existing = await service.get(item_id)
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND)
        await check_existing(session, asset_user, existing)
        if policy.before_delete is not None:
            await policy.before_delete(session, asset_user, existing)
        await service.deactivate(item_id, asset_user.id)

    # AM-25: bulk Import/Export -- only mounted when this master opted in
    # with `import_fields`. company_field mirrors this router's own
    # company_scope (SCOPE_COMPANY_ID -> the row's own "company_id" column,
    # SCOPE_SELF -> the Companies master's own "id", SCOPE_NONE -> no
    # company scoping at all), so the same authorization rule create_item
    # already enforces applies to every imported row too.
    if import_fields is not None:
        company_field = {SCOPE_COMPANY_ID: "company_id", SCOPE_SELF: "id", SCOPE_NONE: None}[company_scope]

        @sub.get("/export")
        async def export_items(
            session: AsyncSession = Depends(get_session),
            asset_user=Depends(require_primary_owner()),
        ):
            allowed = await scoped_company_ids(session, asset_user)
            counted: dict = {}
            content = await export_rows(session, model, import_fields, allowed, company_field, counter=counted)
            await obs_events.exported(f"the {prefix.strip('/')} list", counted.get("rows"), {"companies": allowed})
            return Response(
                content=content,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": f"attachment; filename={prefix.strip('/')}_export.xlsx"},
            )

        @sub.get("/import/template")
        async def import_template(_h=Depends(require_primary_owner())):
            return Response(
                content=build_import_template(import_fields),
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": f"attachment; filename={prefix.strip('/')}_import_template.xlsx"},
            )

        @sub.post("/import/preview")
        async def import_preview(
            file: UploadFile = File(...), session: AsyncSession = Depends(get_session),
            asset_user=Depends(require_primary_owner()),
        ):
            content = await read_upload_bounded(file)
            allowed = await scoped_company_ids(session, asset_user)
            name_check = (_import_name_checks(session, model, policy.unique_name_noun)[0]
                          if policy.unique_name_noun else None)
            try:
                result = await preview_import(session, import_fields, content, allowed, company_field,
                                              row_check=name_check)
            except ImportTemplateError as exc:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
            await obs_events.import_previewed(f"the {prefix.strip('/')} list", len(result["valid_rows"]),
                                              len(result["errors"]), file.filename, len(content))
            return result

        @sub.post("/import/commit")
        async def import_commit(
            file: UploadFile = File(...), session: AsyncSession = Depends(get_session),
            asset_user=Depends(require_primary_owner()),
        ):
            content = await read_upload_bounded(file)
            allowed = await scoped_company_ids(session, asset_user)
            name_check = (_import_name_checks(session, model, policy.unique_name_noun)[1]
                          if policy.unique_name_noun else None)
            try:
                result = await commit_import(session, model, import_fields, content, asset_user, allowed, company_field,
                                             before_create=name_check)
            except ImportScopeError as exc:
                await obs_events.import_refused(f"the {prefix.strip('/')} list", str(exc))
                raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc))
            except ImportTemplateError as exc:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
            except ValueError as exc:
                await session.rollback()
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
            # S8: one IMPORT_COMMIT row (each new record also has its own DATA row, same request id).
            obs_events.import_committed(session, f"the {prefix.strip('/')} list",
                                        {"imported": result["imported"], "rows_with_errors": len(result["errors"])},
                                        entity=prefix.strip("/"), file_name=file.filename)
            await session.commit()
            return result

    return sub


# ---------------------------------------------------------------- S3a-1 policies

async def _active_name_exists(session: AsyncSession, model, name: str | None, lock: bool = True) -> bool:
    """Whether an ACTIVE record of `model` already has this name (ignoring case and surrounding spaces).

    Security (concurrency, RACE-1): two requests with one name used to pass this check at the same moment and
    both insert. With `lock`, a transaction-level advisory lock on (table, name) makes the second wait until the
    first has committed, so it then sees the row. (`lock=False` only for the import preview, which writes nothing.)"""
    value = (name or "").strip()
    if lock:
        await session.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"{model.__tablename__}:{value.lower()}"})
    stmt = select(model.id).where(func.lower(func.trim(model.name)) == value.lower(), model.is_active.is_(True))
    return (await session.execute(stmt.limit(1))).first() is not None


async def _refuse_duplicate_name(session: AsyncSession, model, name: str, noun: str) -> None:
    """New vendor / brand: no second ACTIVE record with the same name (ignoring
    case and surrounding spaces). Existing rows are never touched or checked
    against each other; a deactivated twin does not block (it cannot be chosen
    any more, and there is no way to reactivate it)."""
    if await _active_name_exists(session, model, name):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"A {noun} with this name already exists.")


def _import_name_checks(session: AsyncSession, model, noun: str):
    """Security RACE-1 residual (OBS-NAME-IMPORT): the head-office admin's Excel import of brands / vendors follows
    the same one-active-name rule as adding one on the screen. Returns (preview check, commit check), each
    `async (data) -> sentence | None`. The commit check takes the same advisory lock per row; a second row of the
    same name in one file is refused because the first one is already inserted (same transaction)."""
    seen: set[str] = set()

    async def preview(data: dict) -> str | None:
        key = (data.get("name") or "").strip().lower()
        if key in seen:
            return f"Another row in this file already has the {noun} name '{(data.get('name') or '').strip()}'."
        seen.add(key)
        if await _active_name_exists(session, model, data.get("name"), lock=False):
            return f"A {noun} with the name '{(data.get('name') or '').strip()}' already exists."
        return None

    async def commit(data: dict) -> str | None:
        if await _active_name_exists(session, model, data.get("name"), lock=True):
            return f"A {noun} with the name '{(data.get('name') or '').strip()}' already exists."
        return None

    return preview, commit


def _small_master_policy(model, noun: str, plural: str, code_length: int, fallback: str,
                         per_company: bool = False, unique_name: bool = False) -> MasterPolicy:
    """Vendor / brand / cost centre: ADMIN and OPERATOR may ADD one in the flow
    (code made from the name when left out; a cost centre only in the caller's
    companies); changing or removing one stays with the head-office admin."""

    async def before_create(session: AsyncSession, user, data: dict) -> None:
        if per_company:
            await ensure_company_for_create(session, user, data.get("company_id"), noun)
        if unique_name:
            await _refuse_duplicate_name(session, model, data.get("name"), noun.removeprefix("a ").removeprefix("an "))
        if data.get("code") is None:
            data["code"] = await unique_code(
                session, model, data.get("name"), max_length=code_length, fallback=fallback,
                scope={"company_id": data.get("company_id")} if per_company else None,
            )

    return MasterPolicy(
        create=require_small_create(noun),
        edit=require_head_office(f"change {plural}"),
        delete=require_head_office(f"remove {plural}"),
        before_create=before_create,
        unique_name_noun=noun.removeprefix("a ").removeprefix("an ") if unique_name else None,
    )


# A vendor's code column allows 100 characters; a code made from a name is kept
# to 30 so it stays readable in pickers and on screens.
AUTO_VENDOR_CODE_LENGTH = 30

VENDOR_POLICY = _small_master_policy(models.Vendor, "a vendor", "vendors", AUTO_VENDOR_CODE_LENGTH, "VENDOR", unique_name=True)
BRAND_POLICY = _small_master_policy(models.Brand, "a brand", "brands", 20, "BRAND", unique_name=True)
COST_CENTER_POLICY = _small_master_policy(models.CostCenter, "a cost centre", "cost centres", 20, "CC", per_company=True)

DOMAIN_ADMIN_WHAT = "add or change categories and sub-categories"


def _area(domain: str | None) -> str:
    return AREA_WORDS.get(domain or "", domain or "")


async def _category_before_create(session: AsyncSession, user, data: dict) -> None:
    if data.get("asset_domain") not in models.ASSET_DOMAINS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose who handles this category: IT or Non-IT.")
    await ensure_domain_manage(session, user, data["asset_domain"])
    if data.get("code") is None:
        # S5: no code typed -> one made from the name (the asset code may use it, so it stays short).
        data["code"] = await unique_code(session, models.AssetCategory, data.get("name"), max_length=20, fallback="CAT")


async def _category_before_edit(session: AsyncSession, user, existing, data: dict) -> None:
    """Own work area only; moving the category to the other work area needs
    someone who handles both AND `confirm_domain_change: true`. Writes the
    audit rows (name, work area)."""
    confirmed = bool(data.pop("confirm_domain_change", False))
    await ensure_domain_manage(session, user, existing.asset_domain)
    new_domain = data.get("asset_domain")
    if new_domain not in models.ASSET_DOMAINS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Choose who handles this category: IT or Non-IT.")
    if new_domain != existing.asset_domain:
        await ensure_work_area_change(session, user, "a category")
        if not confirmed:
            subs = (await session.execute(select(func.count()).select_from(models.AssetSubcategory).where(
                models.AssetSubcategory.category_id == existing.id, models.AssetSubcategory.is_active.is_(True))
            )).scalar_one()
            from app.items.models import Item          # local: items imports masters
            items = (await session.execute(select(func.count()).select_from(Item).where(
                Item.category_id == existing.id, Item.is_active.is_(True))
            )).scalar_one()
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Moving {existing.name} from {TEAM_WORDS[existing.asset_domain]} to {TEAM_WORDS[new_domain]} also moves "
                f"its {subs} sub-categor{'y' if subs == 1 else 'ies'} and {items} Item{'' if items == 1 else 's'}, and "
                f"{TEAM_WORDS[new_domain]} will handle the assets added under it from now on (assets already in the "
                "register keep their work area). Confirm the change to go ahead.",
            )
    audit.record(session, entity="category", entity_id=existing.id, actor_id=user.id, changes={
        "name": (existing.name, (data.get("name") or "").strip() or existing.name),
        "work_area": (_area(existing.asset_domain), _area(new_domain)),
    })


BLOCKER_NAMES = 3


def _blocker_phrase(names: list[str], total: int, one: str, many: str) -> str:
    shown = ", ".join(names[:BLOCKER_NAMES])
    if total > BLOCKER_NAMES:
        shown += f" and {total - BLOCKER_NAMES} more"
    return f"{total} active {one if total == 1 else many} ({shown})"


async def _active_names(session: AsyncSession, model, column, value) -> tuple[list[str], int]:
    """The first few names (by name) and the number of ACTIVE rows of `model` whose `column` is `value`."""
    names = list((await session.execute(
        select(model.name).where(column == value, model.is_active.is_(True)).order_by(model.name).limit(BLOCKER_NAMES)
    )).scalars().all())
    total = (await session.execute(
        select(func.count()).select_from(model).where(column == value, model.is_active.is_(True))
    )).scalar_one() if names else 0
    return names, total


def _refuse_deactivation(name: str, blockers: list[str], what: str) -> None:
    if blockers:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"{name} cannot be deactivated because it still has {' and '.join(blockers)}. "
            f"Deactivate them or move them to another {what} first. Assets already in the register keep their group.",
        )


async def _item_counts(session: AsyncSession, column, ids: list[int]) -> dict[int, int]:
    """S6: active Items per Category / Sub-category -- one aggregate query for the whole list."""
    from app.items.models import Item          # local: items imports masters
    if not ids:
        return {}
    return dict((await session.execute(
        select(column, func.count()).select_from(Item)
        .where(Item.is_active.is_(True), column.in_(ids)).group_by(column)
    )).all())


async def _category_list_counts(session: AsyncSession, rows: list) -> list:
    from app.items.models import Item          # local: items imports masters
    counts = await _item_counts(session, Item.category_id, [r.id for r in rows])
    return [schemas.AssetCategoryOut.model_validate(r).model_copy(update={"item_count": counts.get(r.id, 0)}) for r in rows]


async def _subcategory_list_counts(session: AsyncSession, rows: list) -> list:
    from app.items.models import Item          # local: items imports masters
    counts = await _item_counts(session, Item.subcategory_id, [r.id for r in rows])
    return [schemas.AssetSubcategoryOut.model_validate(r).model_copy(update={"item_count": counts.get(r.id, 0)}) for r in rows]


async def _category_before_delete(session: AsyncSession, user, existing) -> None:
    """S6: a Category that still has active Sub-categories or active Items is not deactivated (they would be
    left under a group nobody can choose); the refusal names what blocks it."""
    from app.items.models import Item          # local: items imports masters
    await ensure_domain_manage(session, user, existing.asset_domain)
    blockers = []
    subs, sub_total = await _active_names(session, models.AssetSubcategory, models.AssetSubcategory.category_id, existing.id)
    if sub_total:
        blockers.append(_blocker_phrase(subs, sub_total, "sub-category", "sub-categories"))
    items, item_total = await _active_names(session, Item, Item.category_id, existing.id)
    if item_total:
        blockers.append(_blocker_phrase(items, item_total, "Item", "Items"))
    _refuse_deactivation(existing.name, blockers, "group")
    audit.record(session, entity="category", entity_id=existing.id, actor_id=user.id,
                 changes={"active": (existing.is_active, False)})


async def _parent_domain(session: AsyncSession, category_id: int | None) -> str | None:
    category = await session.get(models.AssetCategory, category_id) if category_id is not None else None
    return category.asset_domain if category is not None else None


async def _subcategory_before_create(session: AsyncSession, user, data: dict) -> None:
    # A sub-category belongs to its category's work area: no sub-category under
    # a category of the other team. (A missing category is a 422 further on.)
    await ensure_domain_manage(session, user, await _parent_domain(session, data.get("category_id")))
    if data.get("code") is None:
        # S5: no code typed -> one made from the name, unique inside its category.
        data["code"] = await unique_code(session, models.AssetSubcategory, data.get("name"), max_length=20, fallback="SUB",
                                         scope={"category_id": data.get("category_id")})


async def _subcategory_before_edit(session: AsyncSession, user, existing, data: dict) -> None:
    await ensure_domain_manage(session, user, await _parent_domain(session, existing.category_id))
    audit.record(session, entity="subcategory", entity_id=existing.id, actor_id=user.id, changes={
        "name": (existing.name, (data.get("name") or "").strip() or existing.name),
    })


async def _subcategory_before_delete(session: AsyncSession, user, existing) -> None:
    """S6: a Sub-category that still has active Items is not deactivated; the refusal names them."""
    from app.items.models import Item          # local: items imports masters
    await ensure_domain_manage(session, user, await _parent_domain(session, existing.category_id))
    items, item_total = await _active_names(session, Item, Item.subcategory_id, existing.id)
    _refuse_deactivation(existing.name, [_blocker_phrase(items, item_total, "Item", "Items")] if item_total else [],
                         "sub-category")
    audit.record(session, entity="subcategory", entity_id=existing.id, actor_id=user.id,
                 changes={"active": (existing.is_active, False)})


CATEGORY_POLICY = MasterPolicy(
    create=require_domain_admin(DOMAIN_ADMIN_WHAT), edit=require_domain_admin(DOMAIN_ADMIN_WHAT),
    delete=require_domain_admin(DOMAIN_ADMIN_WHAT),
    before_create=_category_before_create, before_edit=_category_before_edit, before_delete=_category_before_delete,
    annotate_list=_category_list_counts,
)
SUBCATEGORY_POLICY = MasterPolicy(
    create=require_domain_admin(DOMAIN_ADMIN_WHAT), edit=require_domain_admin(DOMAIN_ADMIN_WHAT),
    delete=require_domain_admin(DOMAIN_ADMIN_WHAT),
    before_create=_subcategory_before_create, before_edit=_subcategory_before_edit,
    before_delete=_subcategory_before_delete, annotate_list=_subcategory_list_counts,
)


router.include_router(build_master_router(
    "/companies", models.Company, schemas.CompanyIn, schemas.CompanyOut, SCOPE_SELF,
    schema_edit=schemas.CompanyEditIn,
    import_fields=[
        FieldSpec("Code", "code", required=True, max_length=20),
        FieldSpec("Name", "name", required=True, max_length=200),
    ],
))
router.include_router(build_master_router(
    "/locations", models.Location, schemas.LocationIn, schemas.LocationOut, SCOPE_COMPANY_ID,
    schema_edit=schemas.LocationEditIn,
    import_fields=[
        FieldSpec("Company Code", "company_id", required=True, lookup=(models.Company, "code")),
        FieldSpec("Code", "code", required=True, max_length=20),
        FieldSpec("Name", "name", required=True, max_length=200),
        FieldSpec("Address", "address", max_length=500),
    ],
))
router.include_router(build_master_router(
    "/departments", models.Department, schemas.DepartmentIn, schemas.DepartmentOut,
    schema_edit=schemas.DepartmentEditIn,
    import_fields=[
        FieldSpec("Name", "name", required=True, max_length=200),
    ],
))
router.include_router(build_master_router(
    "/cost-centers", models.CostCenter, schemas.CostCenterIn, schemas.CostCenterOut, SCOPE_COMPANY_ID,
    schema_edit=schemas.CostCenterEditIn,
    policy=COST_CENTER_POLICY,
    import_fields=[
        FieldSpec("Company Code", "company_id", required=True, lookup=(models.Company, "code")),
        FieldSpec("Code", "code", required=True, max_length=20),
        FieldSpec("Name", "name", required=True, max_length=200),
    ],
))
def _validate_category(data: dict, existing=None) -> None:
    if data.get("asset_domain") not in models.ASSET_DOMAINS:
        raise ValueError("Choose who handles this category: IT or Non-IT.")


def _validate_vendor(data: dict, existing=None) -> None:
    """S0.10: GSTIN (15 characters) and contact email formats -- only for a
    value that is new or changed, so a stored legacy value never blocks an
    unrelated edit. A valid GSTIN is stored in capitals."""
    gstin = (data.get("gstin") or "").strip() or None
    if gstin is None or existing is None or (existing.gstin or "").strip().upper() != gstin.upper():
        data["gstin"] = check_gstin(gstin)
    email = (data.get("contact_email") or "").strip() or None
    if email is None or existing is None or (existing.contact_email or "").strip() != email:
        data["contact_email"] = check_email(email, "Contact email")


router.include_router(build_master_router(
    "/categories", models.AssetCategory, schemas.AssetCategoryIn, schemas.AssetCategoryOut,
    schema_edit=schemas.AssetCategoryEditIn,
    validate_incoming=_validate_category,
    policy=CATEGORY_POLICY,
    import_fields=[
        FieldSpec("Code", "code", required=True, max_length=20),
        FieldSpec("Name", "name", required=True, max_length=200),
        FieldSpec("Responsibility", "asset_domain", required=True, kind="enum", enum_values=models.ASSET_DOMAINS),
    ],
))
router.include_router(build_master_router(
    "/subcategories", models.AssetSubcategory, schemas.AssetSubcategoryIn, schemas.AssetSubcategoryOut,
    schema_edit=schemas.AssetSubcategoryEditIn,
    policy=SUBCATEGORY_POLICY,
    import_fields=[
        FieldSpec("Category Code", "category_id", required=True, lookup=(models.AssetCategory, "code")),
        FieldSpec("Code", "code", required=True, max_length=20),
        FieldSpec("Name", "name", required=True, max_length=200),
    ],
))
router.include_router(build_master_router(
    "/brands", models.Brand, schemas.BrandIn, schemas.BrandOut,
    schema_edit=schemas.BrandEditIn,
    policy=BRAND_POLICY,
    import_fields=[
        FieldSpec("Code", "code", required=True, max_length=20),
        FieldSpec("Name", "name", required=True, max_length=200),
    ],
))
router.include_router(build_master_router(
    "/vendors", models.Vendor, schemas.VendorIn, schemas.VendorOut,
    schema_edit=schemas.VendorEditIn,
    validate_incoming=_validate_vendor,
    policy=VENDOR_POLICY,
    import_fields=[
        FieldSpec("Code", "code", required=True, max_length=100),
        FieldSpec("Name", "name", required=True, max_length=200),
        FieldSpec("GSTIN", "gstin", max_length=20),
        FieldSpec("Contact Name", "contact_name", max_length=200),
        FieldSpec("Contact Phone", "contact_phone", max_length=30),
        FieldSpec("Contact Email", "contact_email", max_length=200),
    ],
))

# AM-05: Custom Fields has its own bespoke router (scope authorization +
# field_key/field_type/scope immutability rules no other master needs) --
# see app/masters/custom_fields_router.py.
router.include_router(custom_fields_router)
