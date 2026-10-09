from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from app.bundles.models import Bundle
from app.bundles.schemas import BundleIn, BundleOut
from app.bundles.service import create_bundle, deactivate_bundle, list_bundles, update_bundle
from app.core.db import get_session
from app.core.deps import get_current_asset_user, require_primary_owner

router = APIRouter(prefix="/api/bundles", tags=["bundles"])


async def _bundle_out(session: AsyncSession, bundle_id: int) -> dict:
    return next(b for b in await list_bundles(session) if b["id"] == bundle_id)


async def _get_active_bundle(session: AsyncSession, bundle_id: int) -> Bundle:
    bundle = await session.get(Bundle, bundle_id)
    if bundle is None or not bundle.is_active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "bundle not found")
    return bundle


@router.get("", response_model=list[BundleOut])
async def list_all(session: AsyncSession = Depends(get_session), _user=Depends(get_current_asset_user)):
    return await list_bundles(session)


@router.post("", response_model=BundleOut, status_code=201)
async def create(
    body: BundleIn, session: AsyncSession = Depends(get_session), actor=Depends(require_primary_owner()),
):
    try:
        bundle = await create_bundle(session, body.model_dump(), actor)
        await session.commit()
    except (ValueError, IntegrityError) as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc) if isinstance(exc, ValueError) else "a bundle with this name already exists")
    return await _bundle_out(session, bundle.id)


@router.put("/{bundle_id}", response_model=BundleOut)
async def update(
    bundle_id: int, body: BundleIn, session: AsyncSession = Depends(get_session),
    actor=Depends(require_primary_owner()),
):
    bundle = await _get_active_bundle(session, bundle_id)
    try:
        await update_bundle(session, bundle, body.model_dump(), actor)
        await session.commit()
    except (ValueError, IntegrityError) as exc:
        await session.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc) if isinstance(exc, ValueError) else "a bundle with this name already exists")
    return await _bundle_out(session, bundle_id)


@router.delete("/{bundle_id}", status_code=204)
async def deactivate(
    bundle_id: int, session: AsyncSession = Depends(get_session), actor=Depends(require_primary_owner()),
):
    bundle = await _get_active_bundle(session, bundle_id)
    await deactivate_bundle(session, bundle, actor)
    await session.commit()
