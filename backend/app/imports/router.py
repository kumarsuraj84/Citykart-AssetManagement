from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import require_role
from app.imports.asset_import_service import build_template, commit_import, preview_import
from app.imports.schemas import ImportCommitOut, ImportPreviewOut

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
    _h=Depends(require_role("ADMIN", "IT_TEAM")),
):
    content = await file.read()
    return await preview_import(session, content)


@router.post("/commit", response_model=ImportCommitOut)
async def commit(
    file: UploadFile = File(...), session: AsyncSession = Depends(get_session),
    actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    content = await file.read()
    result = await commit_import(session, content, actor)
    await session.commit()
    return result
