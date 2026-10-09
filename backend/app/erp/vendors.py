"""Linking CKAM vendors to ERP suppliers (by the ERP supplier code), and adding
a CKAM vendor straight from an ERP supplier."""
import re
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.asset_users.models import AssetUser
from app.erp.source import ErpSource, ErpVendor
from app.masters.models import Vendor


def _norm(text: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


async def list_erp_vendors(session: AsyncSession, source: ErpSource) -> list[dict]:
    """Every ERP supplier, with the CKAM vendor it is linked to, or -- when not
    linked -- the unlinked CKAM vendor whose name/code looks the same."""
    erp = await source.vendors()
    ckam = (await session.execute(select(Vendor).where(Vendor.is_active.is_(True)))).scalars().all()
    by_erp_code = {v.erp_vendor_code: v for v in ckam if v.erp_vendor_code}
    unlinked = [v for v in ckam if not v.erp_vendor_code]
    out = []
    for e in erp:
        linked = by_erp_code.get(e.code)
        suggestion = None
        if linked is None:
            keys = {_norm(e.name), _norm(e.code)} - {""}
            suggestion = next((v for v in unlinked if _norm(v.name) in keys or _norm(v.code) in keys), None)
        out.append({
            "erp_code": e.code, "name": e.name, "gstin": e.gstin, "contact_name": e.contact_name,
            "phone": e.phone, "email": e.email, "is_active": e.is_active,
            "linked_vendor_id": linked.id if linked else None, "linked_vendor_name": linked.name if linked else None,
            "suggested_vendor_id": suggestion.id if suggestion else None,
            "suggested_vendor_name": suggestion.name if suggestion else None,
        })
    return out


async def _erp_vendor(source: ErpSource, erp_code: str) -> ErpVendor:
    found = next((v for v in await source.vendors() if v.code == erp_code), None)
    if found is None:
        raise ValueError(f"supplier {erp_code} was not found in the ERP")
    return found


async def _linked_to(session: AsyncSession, erp_code: str) -> Vendor | None:
    return (await session.execute(
        select(Vendor).where(Vendor.erp_vendor_code == erp_code).limit(1)
    )).scalar_one_or_none()


async def import_vendor(session: AsyncSession, actor: AssetUser, source: ErpSource, erp_code: str) -> Vendor:
    """Creates a CKAM vendor from an ERP supplier. The CKAM vendor Code is the
    ERP supplier code (unique and stable); the name, GSTIN and contact come
    from the ERP and can be edited afterwards like any vendor."""
    erp = await _erp_vendor(source, erp_code)
    if await _linked_to(session, erp_code) is not None:
        raise ValueError(f"{erp.name} is already a vendor here")
    clash = (await session.execute(select(Vendor.id).where(Vendor.code == erp.code).limit(1))).scalar_one_or_none()
    if clash is not None:
        raise ValueError(f"a vendor with the code {erp.code} already exists; link it instead of adding a new one")
    vendor = Vendor(
        code=erp.code, name=erp.name[:200], gstin=(erp.gstin or None), contact_name=erp.contact_name,
        contact_phone=erp.phone, contact_email=erp.email, erp_vendor_code=erp.code,
        created_by=actor.id, updated_by=actor.id,
    )
    session.add(vendor)
    await session.flush()
    return vendor


async def link_vendor(session: AsyncSession, actor: AssetUser, source: ErpSource, vendor_id: int, erp_code: str) -> Vendor:
    vendor = await session.get(Vendor, vendor_id)
    if vendor is None or not vendor.is_active:
        raise LookupError("vendor not found")
    erp = await _erp_vendor(source, erp_code)
    other = await _linked_to(session, erp_code)
    if other is not None and other.id != vendor.id:
        raise ValueError(f"{erp.name} is already linked to the vendor {other.name}")
    vendor.erp_vendor_code = erp_code
    vendor.updated_by = actor.id
    await session.flush()
    return vendor


async def unlink_vendor(session: AsyncSession, actor: AssetUser, vendor_id: int) -> Vendor:
    vendor = await session.get(Vendor, vendor_id)
    if vendor is None:
        raise LookupError("vendor not found")
    vendor.erp_vendor_code = None
    vendor.updated_by = actor.id
    await session.flush()
    return vendor
