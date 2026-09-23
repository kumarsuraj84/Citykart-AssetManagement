from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import require_role, scoped_company_ids
from app.imports.asset_import_service import ImportScopeError, build_template, commit_import, preview_import
from app.imports.schemas import ImportCommitOut, ImportPreviewOut
from app.lifecycle.state_machine import LifecycleError

router = APIRouter(prefix="/api/imports/assets", tags=["imports"])


@router.get("/template")
async def download_template(_h=Depends(require_role("ADMIN", "IT_TEAM"))):
    return Response(
        content=build_template(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=asset_import_template.xlsx"},
    )


@router.post("/preview", response_model=ImportPreviewOut)
async def preview(
    file: UploadFile = File(...), session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    content = await file.read()
    return await preview_import(session, content, scoped_company_ids(actor))


@router.post("/commit", response_model=ImportCommitOut)
async def commit(
    file: UploadFile = File(...), session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    content = await file.read()
    try:
        result = await commit_import(session, content, actor, scoped_company_ids(actor))
    except ImportScopeError as exc:
        # A write aimed at a company the actor can't access: refuse the whole file
        # (nothing written) with 403, same as POST /api/assets for another company.
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc))
    except (ValueError, LifecycleError) as exc:
        # Backstop only: commit_import already reports per-row code-rule/lifecycle
        # failures as row errors; anything else of this kind is still a bad request,
        # never a raw 500.
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    await session.commit()
    return result
