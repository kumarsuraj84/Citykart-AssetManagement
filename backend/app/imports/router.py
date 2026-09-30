from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import require_primary_owner, scoped_company_ids
from app.imports.asset_import_service import (
    ImportScopeError, ImportTemplateError, build_template, commit_import, preview_import,
)
from app.imports import movement_import_service, po_import_service
from app.imports.schemas import ImportCommitOut, ImportPreviewOut
from app.lifecycle.state_machine import LifecycleError

router = APIRouter(prefix="/api/imports/assets", tags=["imports"])

# AM-23: "add" creates new assets (the original behaviour); "edit" bulk-
# corrects existing ones by Asset Code. One set of routes, mode-dispatched,
# rather than a second copy of /template, /preview, /commit.
ImportMode = Query("add", pattern="^(add|edit)$")


@router.get("/template")
async def download_template(mode: str = ImportMode, _h=Depends(require_primary_owner())):
    filename = "asset_import_edit_template.xlsx" if mode == "edit" else "asset_import_template.xlsx"
    return Response(
        content=build_template(mode),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.post("/preview", response_model=ImportPreviewOut)
async def preview(
    file: UploadFile = File(...), mode: str = ImportMode, session: AsyncSession = Depends(get_session),
    actor=Depends(require_primary_owner()),
):
    content = await file.read()
    try:
        return await preview_import(session, content, await scoped_company_ids(session, actor), mode)
    except ImportTemplateError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


@router.post("/commit", response_model=ImportCommitOut)
async def commit(
    file: UploadFile = File(...), mode: str = ImportMode, session: AsyncSession = Depends(get_session),
    actor=Depends(require_primary_owner()),
):
    content = await file.read()
    try:
        result = await commit_import(session, content, actor, await scoped_company_ids(session, actor), mode)
    except ImportScopeError as exc:
        # A write aimed at a company the actor can't access: refuse the whole file
        # (nothing written) with 403, same as POST /api/assets for another company.
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc))
    except ImportTemplateError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    except (ValueError, LifecycleError) as exc:
        # Backstop only: commit_import already reports per-row code-rule/lifecycle
        # failures as row errors; anything else of this kind is still a bad request,
        # never a raw 500.
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.commit()
    return result


# User-directed feature (2026-09-30): import a Purchase Order and its line
# items from Excel, and import a batch of asset movements -- Primary-
# Owner-only, same gate as asset import, kept consistent across every bulk
# import capability even though neither of these creates a real Asset
# directly (a PO import only creates PENDING lines; a movement import only
# does what a manual move already can).
po_router = APIRouter(prefix="/api/imports/purchase-orders", tags=["imports"])


@po_router.get("/template")
async def download_po_template(_h=Depends(require_primary_owner())):
    return Response(
        content=po_import_service.build_template(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=po_import_template.xlsx"},
    )


@po_router.post("/preview", response_model=ImportPreviewOut)
async def preview_po(
    file: UploadFile = File(...), session: AsyncSession = Depends(get_session),
    actor=Depends(require_primary_owner()),
):
    content = await file.read()
    try:
        return await po_import_service.preview_import(session, content, await scoped_company_ids(session, actor))
    except ImportTemplateError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


@po_router.post("/commit", response_model=ImportCommitOut)
async def commit_po(
    file: UploadFile = File(...), session: AsyncSession = Depends(get_session),
    actor=Depends(require_primary_owner()),
):
    content = await file.read()
    try:
        result = await po_import_service.commit_import(session, content, actor, await scoped_company_ids(session, actor))
    except ImportScopeError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc))
    except ImportTemplateError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    except ValueError as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.commit()
    return result


movement_router = APIRouter(prefix="/api/imports/movements", tags=["imports"])


@movement_router.get("/template")
async def download_movement_template(_h=Depends(require_primary_owner())):
    return Response(
        content=movement_import_service.build_template(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=movement_import_template.xlsx"},
    )


@movement_router.post("/preview", response_model=ImportPreviewOut)
async def preview_movements(
    file: UploadFile = File(...), session: AsyncSession = Depends(get_session),
    actor=Depends(require_primary_owner()),
):
    content = await file.read()
    try:
        return await movement_import_service.preview_import(
            session, content, await scoped_company_ids(session, actor), actor.role,
        )
    except ImportTemplateError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


@movement_router.post("/commit", response_model=ImportCommitOut)
async def commit_movements(
    file: UploadFile = File(...), session: AsyncSession = Depends(get_session),
    actor=Depends(require_primary_owner()),
):
    content = await file.read()
    try:
        result = await movement_import_service.commit_import(session, content, actor, await scoped_company_ids(session, actor))
    except ImportScopeError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc))
    except ImportTemplateError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    except (ValueError, LifecycleError) as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.commit()
    return result
