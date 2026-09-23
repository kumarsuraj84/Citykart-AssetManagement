from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import get_current_holder, require_role
from app.assets.router import _get_scoped_asset
from app.documents.models import AssetDocument
from app.documents.schemas import AssetDocumentOut
from app.documents.service import save_document

router = APIRouter(tags=["documents"])


@router.post("/api/assets/{asset_id}/documents", response_model=AssetDocumentOut, status_code=201)
async def upload_document(
    asset_id: int, doc_type: str = Form(...), file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session), actor=Depends(require_role("ADMIN", "IT_TEAM")),
):
    asset = await _get_scoped_asset(asset_id, session, actor)
    content = await file.read()
    try:
        doc = await save_document(asset.id, doc_type, file.filename, content, file.content_type or "application/octet-stream", actor.id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    session.add(doc)
    await session.commit()
    await session.refresh(doc)
    return doc


@router.get("/api/assets/{asset_id}/documents", response_model=list[AssetDocumentOut])
async def list_documents(
    asset_id: int, session: AsyncSession = Depends(get_session), holder=Depends(get_current_holder),
):
    asset = await _get_scoped_asset(asset_id, session, holder)
    stmt = select(AssetDocument).where(AssetDocument.asset_id == asset.id)
    return (await session.execute(stmt)).scalars().all()


@router.get("/api/documents/{doc_id}/download")
async def download_document(
    doc_id: int, session: AsyncSession = Depends(get_session), holder=Depends(get_current_holder),
):
    doc = await session.get(AssetDocument, doc_id)
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    await _get_scoped_asset(doc.asset_id, session, holder)  # raises 404 if out of scope
    return FileResponse(doc.stored_path, media_type=doc.mime_type, filename=doc.file_name)
