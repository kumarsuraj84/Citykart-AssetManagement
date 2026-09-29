from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import require_role, scoped_company_ids
from app.imports.asset_import_service import (
    ImportScopeError, ImportTemplateError, build_template, commit_import, preview_import,
)
from app.imports.schemas import ImportCommitOut, ImportPreviewOut
from app.lifecycle.state_machine import LifecycleError

router = APIRouter(prefix="/api/imports/assets", tags=["imports"])

# AM-23: "add" creates new assets (the original behaviour); "edit" bulk-
# corrects existing ones by Asset Code. One set of routes, mode-dispatched,
# rather than a second copy of /template, /preview, /commit.
ImportMode = Query("add", pattern="^(add|edit)$")


@router.get("/template")
async def download_template(mode: str = ImportMode, _h=Depends(require_role("ADMIN", "IT_TEAM"))):
    filename = "asset_import_edit_template.xlsx" if mode == "edit" else "asset_import_template.xlsx"
    return Response(
        content=build_template(mode),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.post("/preview", response_model=ImportPreviewOut)
async def preview(
    file: UploadFile = File(...), mode: str = ImportMode, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    content = await file.read()
    try:
        return await preview_import(session, content, await scoped_company_ids(session, actor), mode)
    except ImportTemplateError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


@router.post("/commit", response_model=ImportCommitOut)
async def commit(
    file: UploadFile = File(...), mode: str = ImportMode, session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
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
